import type { CoreMessage } from '@mastra/core';
import { getAgent } from './index';
import { extractJsonObject } from './parse';
import { RecommendationOutput, type RecommendationOutputT } from './output';
import { validateRecommendations } from './validate';
import { limits } from '@/lib/limits';

export type { CoreMessage };

interface MastraUsage {
  promptTokens?: number;
  completionTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}

interface MastraToolCall {
  toolName?: string;
  toolCallId?: string;
  args?: unknown;
}

interface MastraToolResult {
  toolCallId?: string;
  result?: unknown;
}

/**
 * Subset of Mastra's onStepFinish callback argument that we actually read.
 * Mastra's full type is wider; this narrows to the fields we use.
 */
interface MastraStepInfo {
  text?: string;
  usage?: MastraUsage;
  toolCalls?: MastraToolCall[];
  toolResults?: MastraToolResult[];
}

export interface AgentRunEvents {
  onText: (turn: number, text: string) => void;
  onToolCall: (
    turn: number,
    toolName: string,
    input: Record<string, unknown>,
    output: unknown,
    durationMs: number,
  ) => void;
}

export interface AgentRunResult {
  output: RecommendationOutputT;
  newMessages: CoreMessage[];
  inputTokens: number;
  outputTokens: number;
  toolCallsCount: number;
  stepTexts: { turn: number; text: string }[];
}

export class CycleAbortError extends Error {
  constructor(public reason: 'timeout' | 'cycle_token_budget') {
    super(reason === 'timeout' ? 'cycle wallclock timeout' : 'cycle token budget exceeded');
  }
}

/**
 * Drive the recommender agent for a single cycle (one user prompt).
 *
 * Owns: validation-retry loop, wallclock + token-budget abort, structured
 * output extraction. Knows nothing about sessions, the DB, or the SSE bus —
 * the caller wires those via the `emit` callbacks.
 */
export async function runAgentCycle(args: {
  userPrompt: string;
  priorMessages: CoreMessage[];
  emit?: AgentRunEvents;
}): Promise<AgentRunResult> {
  const { userPrompt, priorMessages, emit } = args;
  const agent = await getAgent();

  let totalIn = 0;
  let totalOut = 0;
  let toolCallsCount = 0;
  let lastText = '';
  let turn = 0;

  const messages: CoreMessage[] = [...priorMessages, { role: 'user', content: userPrompt }];
  const stepTexts: { turn: number; text: string }[] = [];

  const ac = new AbortController();
  let abortReason: CycleAbortError['reason'] | null = null;
  const timeoutHandle = setTimeout(() => {
    if (!ac.signal.aborted) {
      abortReason = 'timeout';
      ac.abort();
    }
  }, limits.cycleTimeoutMs);

  const providerOptions =
    limits.thinkingBudgetTokens > 0
      ? {
          anthropic: {
            thinking: {
              type: 'enabled' as const,
              budgetTokens: limits.thinkingBudgetTokens,
            },
          },
        }
      : undefined;

  try {
    for (let attempt = 0; attempt <= limits.validationRetries; attempt++) {
      const onStepFinish = (step: MastraStepInfo) => {
        turn += 1;
        totalIn += Number(step.usage?.promptTokens ?? step.usage?.inputTokens ?? 0);
        totalOut += Number(step.usage?.completionTokens ?? step.usage?.outputTokens ?? 0);
        if (totalIn + totalOut > limits.cycleTokenBudget && !ac.signal.aborted) {
          abortReason = 'cycle_token_budget';
          ac.abort();
        }
        const text = String(step.text ?? '').trim();
        if (text) {
          stepTexts.push({ turn, text });
          emit?.onText(turn, text);
        }
        const tcs = step.toolCalls ?? [];
        const trs = step.toolResults ?? [];
        const resByCall = new Map(trs.map((r) => [r.toolCallId, r]));
        for (const tc of tcs) {
          const tr = resByCall.get(tc.toolCallId);
          const toolName = tc.toolName ?? '?';
          const input = (tc.args ?? {}) as Record<string, unknown>;
          const output = tr?.result ?? null;
          toolCallsCount += 1;
          emit?.onToolCall(turn, toolName, input, output, 0);
        }
      };

      const result = await agent
        .generate(messages, {
          maxSteps: limits.agentMaxSteps,
          abortSignal: ac.signal,
          providerOptions,
          onStepFinish,
        })
        .catch((err: unknown) => {
          if (abortReason) throw new CycleAbortError(abortReason);
          throw err;
        });

      lastText = String(result.text ?? '');

      const fail = (nudge: string) => {
        messages.push({ role: 'assistant', content: lastText || '(no text emitted)' });
        messages.push({ role: 'user', content: nudge });
      };

      if (!lastText.trim()) {
        fail(
          'You stopped without producing a final response. Do NOT call any more tools. Reply RIGHT NOW with the JSON object specified in the system prompt — recommendations + follow_up_suggestion — using rating_keys you already have from prior tool results. No preamble, no markdown fences, just the JSON.',
        );
        continue;
      }

      let parsed: unknown;
      try {
        parsed = extractJsonObject(lastText);
      } catch (err) {
        fail(
          `Your previous response did not contain a valid JSON object (${err instanceof Error ? err.message : String(err)}). Reply with the JSON object exactly as specified in the system prompt — no preamble, no markdown fences.`,
        );
        continue;
      }
      const validated = RecommendationOutput.safeParse(parsed);
      if (!validated.success) {
        fail(
          `Your previous JSON did not match the required schema. Issues: ${validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}. Reply with the corrected JSON object only.`,
        );
        continue;
      }
      const v = await validateRecommendations(validated.data);
      if (!v.ok || !v.cleaned) {
        fail(v.retryMessage ?? 'Please retry with valid rating_keys from tool results.');
        continue;
      }

      messages.push({ role: 'assistant', content: lastText });
      const newMessages = messages.slice(priorMessages.length);
      return {
        output: v.cleaned,
        newMessages,
        inputTokens: totalIn,
        outputTokens: totalOut,
        toolCallsCount,
        stepTexts,
      };
    }

    throw new Error(`agent failed after ${limits.validationRetries + 1} attempt(s)`);
  } finally {
    clearTimeout(timeoutHandle);
  }
}
