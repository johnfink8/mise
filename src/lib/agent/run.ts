import { getAgent, LOOP_LIMITS } from './index';
import { RecommendationOutput, type RecommendationOutputT } from './output';
import { validateRecommendations } from './validate';

export interface RunResult {
  output: RecommendationOutputT;
  dropped: string[];
  retries: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  rawText: string;
}

const MAX_VALIDATION_RETRIES = 2;

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  // First try: whole text is JSON.
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }
  // Fallback: extract the first balanced { ... } block.
  const start = trimmed.indexOf('{');
  if (start < 0) throw new Error('no JSON object in agent response');
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inStr) {
      if (ch === '\\') escape = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const slice = trimmed.slice(start, i + 1);
        return JSON.parse(slice);
      }
    }
  }
  throw new Error('unbalanced JSON object in agent response');
}

type Msg = { role: 'user' | 'assistant'; content: string };

export interface AttemptDiag {
  finishReason: string | undefined;
  toolCalls: number;
  textLen: number;
  textPreview: string;
}

export async function runAgentOnce(prompt: string): Promise<RunResult> {
  const agent = await getAgent();
  let dropped: string[] = [];
  let totalIn = 0;
  let totalOut = 0;
  let totalToolCalls = 0;
  const messages: Msg[] = [{ role: 'user', content: prompt }];
  let lastText = '';
  const diag: AttemptDiag[] = [];

  for (let attempt = 0; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
    let stepIdx = 0;
    console.log('[runAgent attempt %d] start, messages=%d', attempt, messages.length);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await agent.generate(messages as any, {
      maxSteps: LOOP_LIMITS.maxSteps,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onStepFinish: (step: any) => {
        stepIdx++;
        const tcs = (step?.toolCalls ?? []) as Array<{
          toolName?: string;
          args?: unknown;
        }>;
        const textPreview = String(step?.text ?? '').slice(0, 200);
        const finish = step?.finishReason;
        if (tcs.length > 0) {
          for (const tc of tcs) {
            console.log(
              '[runAgent step %d] tool=%s args=%s',
              stepIdx,
              tc.toolName,
              JSON.stringify(tc.args ?? {}).slice(0, 200),
            );
          }
        }
        if (textPreview) {
          console.log('[runAgent step %d] text=%j', stepIdx, textPreview);
        }
        console.log('[runAgent step %d] finish=%s', stepIdx, finish);
      },
    });

    totalIn += Number(result?.usage?.promptTokens ?? result?.usage?.inputTokens ?? 0);
    totalOut += Number(result?.usage?.completionTokens ?? result?.usage?.outputTokens ?? 0);
    totalToolCalls += Number(result?.toolCalls?.length ?? 0);

    lastText = String(result?.text ?? '');
    const finishReason = result?.finishReason as string | undefined;
    diag.push({
      finishReason,
      toolCalls: Number(result?.toolCalls?.length ?? 0),
      textLen: lastText.length,
      textPreview: lastText.slice(0, 300),
    });
    console.log('[runAgent attempt %d] %j', attempt, diag[diag.length - 1]);

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
      const reason = err instanceof Error ? err.message : String(err);
      fail(
        `Your previous response did not contain a valid JSON object (${reason}). Reply with the JSON object exactly as specified in the system prompt — no preamble, no markdown fences.`,
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
    dropped = [...dropped, ...v.dropped];

    if (v.ok && v.cleaned) {
      return {
        output: v.cleaned,
        dropped,
        retries: attempt,
        inputTokens: totalIn,
        outputTokens: totalOut,
        toolCalls: totalToolCalls,
        rawText: lastText,
      };
    }

    fail(v.retryMessage ?? 'Please retry with valid rating_keys from tool results.');
  }

  const err = new Error(
    `agent failed validation after ${MAX_VALIDATION_RETRIES + 1} attempts. Diagnostics: ${JSON.stringify(diag)}`,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (err as any).diag = diag;
  throw err;
}
