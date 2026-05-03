import type { CoreMessage } from '@mastra/core/llm';
import { getAgent, loadSystemPrompt } from './index';
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

/**
 * Subset of Mastra's ChunkType union we read from `fullStream`. Mastra's full
 * union is huge (sources, files, reasoning, routing-agent-text, etc.); we
 * only dispatch on these and ignore the rest. The `payload` shapes mirror
 * Mastra's `TextDeltaPayload` / `ToolCallPayload` / `ToolResultPayload` /
 * `StepFinishPayload`.
 */
interface BaseChunk {
  type: string;
  payload?: unknown;
}
interface StepStartChunk {
  type: 'step-start';
}
interface TextDeltaChunk {
  type: 'text-delta';
  payload: { text?: string };
}
interface ToolCallChunkLike {
  type: 'tool-call';
  payload: { toolName?: string; toolCallId?: string; args?: unknown };
}
interface ToolResultChunkLike {
  type: 'tool-result';
  payload: {
    toolName?: string;
    toolCallId?: string;
    args?: unknown;
    result?: unknown;
  };
}
interface StepFinishChunkLike {
  type: 'step-finish';
  payload: { output?: { usage?: MastraUsage } };
}

function isTextDelta(c: BaseChunk): c is TextDeltaChunk {
  return c.type === 'text-delta';
}
function isToolCall(c: BaseChunk): c is ToolCallChunkLike {
  return c.type === 'tool-call';
}
function isToolResult(c: BaseChunk): c is ToolResultChunkLike {
  return c.type === 'tool-result';
}
function isStepFinish(c: BaseChunk): c is StepFinishChunkLike {
  return c.type === 'step-finish';
}
function isStepStart(c: BaseChunk): c is StepStartChunk {
  return c.type === 'step-start';
}

/**
 * Trim the trailing JSON output from a turn's text so it doesn't show up in
 * the narration ribbon or get persisted. The agent's final-cycle response
 * appends the recommendations JSON to its prose; we only want the prose.
 *
 * Two cases handled in priority order:
 *   1. ```json ... ``` (or ``` ... ```) markdown fence → strip from the fence
 *   2. Bare {"recommendations": ... } JSON object → strip from the brace
 *
 * Earlier-step text doesn't contain these patterns, so this is mostly a
 * no-op until the final step.
 */
/**
 * Wrap untrusted user input in a delimited block so the model treats it as
 * data rather than a continuation of the system prompt. The closing tag
 * is duplicated in the system prompt; any `</user_request>` in the input
 * itself is neutralized so the user can't forge an early close.
 */
function wrapUserInput(s: string): string {
  const safe = s.replace(/<\/?user_request>/gi, '');
  return `<user_request>\n${safe}\n</user_request>`;
}

function stripFinalJsonTail(text: string): string {
  const fenceIdx = text.indexOf('```');
  if (fenceIdx !== -1) return text.slice(0, fenceIdx).trimEnd();
  const m = text.match(/\{\s*"recommendations"/);
  if (m && m.index !== undefined) return text.slice(0, m.index).trimEnd();
  return text;
}

export interface AgentRunEvents {
  /**
   * Cumulative text for `turn` so far. Fires repeatedly as `text-delta` chunks
   * arrive — each fire is the full text up to that point. The caller treats
   * latest-received-per-turn as authoritative.
   */
  onText: (turn: number, cumulativeText: string) => void;
  /** Fires once per tool call, the moment the model emits the call. */
  onToolCallStarted: (
    turn: number,
    toolCallId: string,
    toolName: string,
    input: Record<string, unknown>,
  ) => void;
  /** Fires once per tool call, when the tool's execute() returns. */
  onToolCallCompleted: (
    turn: number,
    toolCallId: string,
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

  // Build the message list with the system prompt up front, marked with an
  // Anthropic ephemeral cache breakpoint. Tool definitions are emitted by the
  // SDK before the system message, so a single breakpoint here covers both
  // the system prompt and the tool schemas — the bulk of every cycle's
  // input. Cache TTL is 5 minutes; in-session follow-ups land within that.
  const systemPrompt = await loadSystemPrompt();
  const messages: CoreMessage[] = [
    {
      role: 'system',
      content: systemPrompt,
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    },
    ...priorMessages,
    { role: 'user', content: wrapUserInput(userPrompt) },
  ];
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
      // `agent.stream()` returns immediately with a MastraModelOutput whose
      // `fullStream` is a ReadableStream of typed chunks. We dispatch on chunk
      // type and emit our own SSE events as they arrive — no buffering until
      // the whole step finishes.
      const output = await agent
        .stream(messages, {
          maxSteps: limits.agentMaxSteps,
          abortSignal: ac.signal,
          providerOptions,
        })
        .catch((err: unknown) => {
          if (abortReason) throw new CycleAbortError(abortReason);
          throw err;
        });

      // Per-turn state. `turn` increments at each step boundary; the model's
      // text streams as `text-delta` chunks tagged by turn. `toolCallStarts`
      // records when a tool-call chunk arrived so the matching tool-result
      // chunk can compute a real duration.
      const textByTurn = new Map<number, string>();
      const toolCallStarts = new Map<string, { t0: number; turnAt: number }>();
      let stepStarted = false;
      let lastStepTextLen = 0;

      const reader = output.fullStream.getReader();
      try {
        while (true) {
          let chunk: BaseChunk | undefined;
          try {
            const r = await reader.read();
            if (r.done) break;
            chunk = r.value as BaseChunk;
          } catch (err) {
            if (abortReason) throw new CycleAbortError(abortReason);
            throw err;
          }
          if (!chunk) continue;

          if (isStepStart(chunk)) {
            turn += 1;
            stepStarted = true;
            lastStepTextLen = 0;
            textByTurn.set(turn, '');
          } else if (isTextDelta(chunk)) {
            if (!stepStarted) {
              // Some models emit text without a leading step-start; treat the
              // first text chunk as starting turn 1.
              turn += 1;
              stepStarted = true;
              textByTurn.set(turn, '');
            }
            const delta = chunk.payload.text ?? '';
            const next = (textByTurn.get(turn) ?? '') + delta;
            textByTurn.set(turn, next);
            // Strip the JSON tail from the *displayed* text so the narration
            // ribbon never shows the recommendations blob.
            emit?.onText(turn, stripFinalJsonTail(next));
          } else if (isToolCall(chunk)) {
            const p = chunk.payload;
            const toolName = p.toolName ?? '?';
            const toolCallId = p.toolCallId ?? `${turn}-${toolCallsCount}`;
            const input = (p.args ?? {}) as Record<string, unknown>;
            toolCallsCount += 1;
            toolCallStarts.set(toolCallId, { t0: Date.now(), turnAt: turn });
            emit?.onToolCallStarted(turn, toolCallId, toolName, input);
          } else if (isToolResult(chunk)) {
            const p = chunk.payload;
            const toolName = p.toolName ?? '?';
            const toolCallId = p.toolCallId ?? '';
            const input = (p.args ?? {}) as Record<string, unknown>;
            const started = toolCallStarts.get(toolCallId);
            const durationMs = started ? Date.now() - started.t0 : 0;
            const startedTurn = started?.turnAt ?? turn;
            emit?.onToolCallCompleted(
              startedTurn,
              toolCallId,
              toolName,
              input,
              p.result ?? null,
              durationMs,
            );
            toolCallStarts.delete(toolCallId);
          } else if (isStepFinish(chunk)) {
            const usage = chunk.payload.output?.usage;
            if (usage) {
              totalIn += Number(usage.promptTokens ?? usage.inputTokens ?? 0);
              totalOut += Number(usage.completionTokens ?? usage.outputTokens ?? 0);
            }
            if (totalIn + totalOut > limits.cycleTokenBudget && !ac.signal.aborted) {
              abortReason = 'cycle_token_budget';
              ac.abort();
            }
            // Snapshot the turn's final text — minus any JSON tail — into
            // stepTexts for later replay in the REASONING expansion.
            const stripped = stripFinalJsonTail(textByTurn.get(turn) ?? '').trim();
            if (stripped && stripped.length > lastStepTextLen) {
              stepTexts.push({ turn, text: stripped });
              lastStepTextLen = stripped.length;
            }
            stepStarted = false;
          }
          // 'finish', 'reasoning', 'source', etc. — irrelevant for our flow.
        }
      } finally {
        reader.releaseLock();
      }

      lastText = (await output.text) ?? '';

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
