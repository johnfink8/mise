import { count, desc, eq, inArray } from 'drizzle-orm';
import { db } from './db/client';
import { movie, recommendation, session, toolCall } from './db/schema';
import { getAgent, LOOP_LIMITS } from './agent';
import { RecommendationOutput, type RecommendationOutputT } from './agent/output';
import { validateRecommendations } from './agent/validate';
import { bus } from './event-bus';
import { buildFeedbackNote } from './feedback-note';
import { refreshFromPlex } from './catalog';

// Mirror of run.ts JSON-extraction (deduplication is fine; this is the only consumer now).
function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }
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
      if (depth === 0) return JSON.parse(trimmed.slice(start, i + 1));
    }
  }
  throw new Error('unbalanced JSON object in agent response');
}

const MAX_VALIDATION_RETRIES = 2;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CoreMessage = { role: 'user' | 'assistant' | 'tool' | 'system'; content: any };

interface CycleArgs {
  sessionId: string;
  cycle: number;
  userPrompt: string;
  priorMessages: CoreMessage[];
}

interface CycleResult {
  newMessages: CoreMessage[];
  output: RecommendationOutputT;
  toolCallsCount: number;
  inputTokens: number;
  outputTokens: number;
  followUp: string | null;
}

export async function startSession(opts: {
  prompt: string;
  formPayload?: Record<string, unknown> | null;
}): Promise<{ sessionId: string }> {
  const [row] = await db
    .insert(session)
    .values({
      userPrompt: opts.prompt,
      prompts: [opts.prompt],
      formPayload: opts.formPayload ?? null,
      status: 'pending',
    })
    .returning({ id: session.id });
  const sessionId = row.id;

  // Fire-and-forget — runCycle owns lifecycle, bus events, and persistence.
  void runCycle({ sessionId, cycle: 0, userPrompt: opts.prompt, priorMessages: [] });
  return { sessionId };
}

export async function continueSession(
  sessionId: string,
  followUpPrompt: string,
): Promise<void> {
  const [s] = await db.select().from(session).where(eq(session.id, sessionId));
  if (!s) throw new Error(`session ${sessionId} not found`);
  if (s.status === 'pending' || s.status === 'running') {
    throw new Error('session is already running');
  }

  const cycle = s.prompts.length;
  await db
    .update(session)
    .set({
      prompts: [...s.prompts, followUpPrompt],
      status: 'pending',
      errorMessage: null,
    })
    .where(eq(session.id, sessionId));

  const prior = (s.messages ?? []) as CoreMessage[];

  void runCycle({
    sessionId,
    cycle,
    userPrompt: followUpPrompt,
    priorMessages: prior,
  });
}

async function runCycle(args: CycleArgs): Promise<void> {
  const { sessionId, cycle, userPrompt } = args;
  const t0 = Date.now();
  bus.publish(sessionId, { type: 'started', data: { session_id: sessionId, cycle } });

  try {
    await db
      .update(session)
      .set({ status: 'running', errorMessage: null })
      .where(eq(session.id, sessionId));

    if (cycle === 0) await refreshFromPlex({ force: false }).catch(() => undefined);

    const note = cycle === 0 ? await buildFeedbackNote() : '';
    const userContent = note ? `${note}\n\n---\n\n${userPrompt}` : userPrompt;

    const { newMessages, output, toolCallsCount, inputTokens, outputTokens, followUp } =
      await runAgentCycle({
        sessionId,
        cycle,
        userPrompt: userContent,
        priorMessages: args.priorMessages,
      });

    // Persist recommendations.
    const insertRows = output.recommendations.map((r, idx) => ({
      sessionId,
      cycle,
      position: idx,
      plexRatingKey: r.rating_key,
      title: '',
      year: null as number | null,
      reasoning: r.reasoning,
      group: r.group ?? null,
    }));
    if (insertRows.length) {
      const keys = insertRows.map((r) => r.plexRatingKey);
      const movies = await db
        .select({ ratingKey: movie.ratingKey, title: movie.title, year: movie.year })
        .from(movie)
        .where(inArray(movie.ratingKey, keys));
      const byKey = new Map(movies.map((m) => [m.ratingKey, m]));
      for (const row of insertRows) {
        const m = byKey.get(row.plexRatingKey);
        if (m) {
          row.title = m.title;
          row.year = m.year;
        }
      }
      await db.insert(recommendation).values(insertRows);
    }

    // Update session: messages, follow-ups, status, usage.
    const allMessages = [...args.priorMessages, ...newMessages];
    const [prev] = await db.select().from(session).where(eq(session.id, sessionId));
    const followUps = [...(prev?.followUpSuggestions ?? [])];
    while (followUps.length < cycle) followUps.push(null);
    followUps[cycle] = followUp;

    await db
      .update(session)
      .set({
        status: 'complete',
        latencyMs: Date.now() - t0,
        inputTokens: (prev?.inputTokens ?? 0) + inputTokens,
        outputTokens: (prev?.outputTokens ?? 0) + outputTokens,
        toolCallsN: (prev?.toolCallsN ?? 0) + toolCallsCount,
        followUpSuggestions: followUps,
        messages: allMessages,
      })
      .where(eq(session.id, sessionId));

    bus.publish(sessionId, {
      type: 'recommendations_ready',
      data: { cycle, recommendations: output.recommendations, follow_up_suggestion: followUp },
    });
    bus.publish(sessionId, { type: 'done', data: {} });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(session)
      .set({
        status: 'error',
        errorMessage: message,
        latencyMs: Date.now() - t0,
      })
      .where(eq(session.id, sessionId));
    bus.publish(sessionId, { type: 'error', data: { cycle, message } });
    bus.publish(sessionId, { type: 'done', data: {} });
  }
}

async function runAgentCycle(args: CycleArgs): Promise<CycleResult> {
  const { sessionId, cycle, userPrompt, priorMessages } = args;
  const agent = await getAgent();
  let totalIn = 0;
  let totalOut = 0;
  let toolCallsCount = 0;
  let lastText = '';
  let turn = 0;

  const messages: CoreMessage[] = [
    ...priorMessages,
    { role: 'user', content: userPrompt },
  ];

  for (let attempt = 0; attempt <= MAX_VALIDATION_RETRIES; attempt++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await agent.generate(messages as any, {
      maxSteps: LOOP_LIMITS.maxSteps,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      onStepFinish: (step: any) => {
        turn += 1;
        const text = String(step?.text ?? '').trim();
        if (text) {
          bus.publish(sessionId, {
            type: 'assistant_text',
            data: { cycle, turn, text },
          });
        }
        const tcs = (step?.toolCalls ?? []) as Array<{
          toolName?: string;
          toolCallId?: string;
          args?: unknown;
        }>;
        const trs = (step?.toolResults ?? []) as Array<{
          toolName?: string;
          toolCallId?: string;
          args?: unknown;
          result?: unknown;
        }>;
        const resByCall = new Map(trs.map((r) => [r.toolCallId, r]));
        for (const tc of tcs) {
          const tr = resByCall.get(tc.toolCallId);
          const toolName = tc.toolName ?? '?';
          const input = (tc.args ?? {}) as Record<string, unknown>;
          const output = (tr?.result ?? null) as unknown;
          toolCallsCount += 1;
          bus.publish(sessionId, {
            type: 'tool_call_started',
            data: { cycle, turn, tool_name: toolName, tool_input: input },
          });
          bus.publish(sessionId, {
            type: 'tool_call_completed',
            data: {
              cycle,
              turn,
              tool_name: toolName,
              tool_input: input,
              tool_output: output,
              duration_ms: 0,
            },
          });
          // Best-effort persistence of tool calls (fire-and-forget; failures shouldn't kill run).
          db.insert(toolCall)
            .values({
              sessionId,
              cycle,
              turn,
              toolName,
              toolInput: input,
              toolOutput: output as unknown as Record<string, unknown> | null,
              durationMs: 0,
            })
            .catch(() => undefined);
        }
      },
    });

    totalIn += Number(result?.usage?.promptTokens ?? result?.usage?.inputTokens ?? 0);
    totalOut += Number(result?.usage?.completionTokens ?? result?.usage?.outputTokens ?? 0);

    lastText = String(result?.text ?? '');

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

    // Successful cycle. Append the final assistant message.
    messages.push({ role: 'assistant', content: lastText });
    const newMessages = messages.slice(priorMessages.length);
    return {
      newMessages,
      output: v.cleaned,
      toolCallsCount,
      inputTokens: totalIn,
      outputTokens: totalOut,
      followUp: v.cleaned.follow_up_suggestion ?? null,
    };
  }

  throw new Error(`agent failed after ${MAX_VALIDATION_RETRIES + 1} attempts`);
}

export async function listSessions(opts: { limit?: number; offset?: number } = {}) {
  const limit = Math.min(opts.limit ?? 20, 100);
  const offset = opts.offset ?? 0;
  const rows = await db
    .select()
    .from(session)
    .orderBy(desc(session.createdAt))
    .limit(limit)
    .offset(offset);
  const [totalRow] = await db.select({ n: count() }).from(session);
  return { sessions: rows, total: totalRow?.n ?? 0 };
}

export async function getSessionDetail(sessionId: string) {
  const [s] = await db.select().from(session).where(eq(session.id, sessionId));
  if (!s) return null;
  const recs = await db
    .select()
    .from(recommendation)
    .where(eq(recommendation.sessionId, sessionId))
    .orderBy(recommendation.cycle, recommendation.position);
  const toolCalls = await db
    .select()
    .from(toolCall)
    .where(eq(toolCall.sessionId, sessionId))
    .orderBy(toolCall.cycle, toolCall.turn, toolCall.createdAt);
  return { session: s, recommendations: recs, toolCalls };
}
