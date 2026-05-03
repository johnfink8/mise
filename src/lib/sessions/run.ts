import { eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { movie, recommendation, session, toolCall } from '@/lib/db/schema';
import { runAgentCycle, type CoreMessage } from '@/lib/agent/run';
import { bus } from '@/lib/event-bus';
import { buildFeedbackNote } from '@/lib/feedback-note';
import { refreshFromPlex } from '@/lib/catalog';
import { limits } from '@/lib/limits';
import { logger } from '@/lib/logger';
import { buildPlayUrl, getMachineIdentifier } from '@/lib/plex';

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

interface CycleArgs {
  sessionId: string;
  cycle: number;
  userPrompt: string;
  priorMessages: CoreMessage[];
}

async function runCycle(args: CycleArgs): Promise<void> {
  const { sessionId, cycle, userPrompt, priorMessages } = args;
  const t0 = Date.now();
  const log = logger.child({ sessionId, cycle });
  log.info({ promptLen: userPrompt.length }, 'cycle start');
  bus.publish(sessionId, { type: 'started', data: { sessionId, cycle } });

  try {
    await db
      .update(session)
      .set({ status: 'running', errorMessage: null })
      .where(eq(session.id, sessionId));

    // Refuse to start if session has already burned through its lifetime budget.
    const [pre] = await db.select().from(session).where(eq(session.id, sessionId));
    const burned = (pre?.inputTokens ?? 0) + (pre?.outputTokens ?? 0);
    if (burned >= limits.sessionTokenCeiling) {
      throw new Error(
        `session token ceiling reached (${burned} / ${limits.sessionTokenCeiling}); start a new session`,
      );
    }

    if (cycle === 0) await refreshFromPlex({ force: false }).catch(() => undefined);

    const note = cycle === 0 ? await buildFeedbackNote() : '';
    const userContent = note ? `${note}\n\n---\n\n${userPrompt}` : userPrompt;

    const { newMessages, output, toolCallsCount, inputTokens, outputTokens, stepTexts } =
      await runAgentCycle({
        userPrompt: userContent,
        priorMessages,
        emit: {
          onText: (turn, cumulativeText) => {
            bus.publish(sessionId, {
              type: 'assistant_text',
              data: { cycle, turn, text: cumulativeText },
            });
          },
          onToolCallStarted: (turn, _toolCallId, toolName, input) => {
            bus.publish(sessionId, {
              type: 'tool_call_started',
              data: { cycle, turn, toolName, toolInput: input },
            });
          },
          onToolCallCompleted: (turn, _toolCallId, toolName, input, output, durationMs) => {
            bus.publish(sessionId, {
              type: 'tool_call_completed',
              data: {
                cycle,
                turn,
                toolName,
                toolInput: input,
                toolOutput: output,
                durationMs,
              },
            });
            // Best-effort persistence; tool-call writes don't gate the run.
            db.insert(toolCall)
              .values({
                sessionId,
                cycle,
                turn,
                toolName,
                toolInput: input,
                toolOutput: output,
                durationMs,
              })
              .catch(() => undefined);
          },
        },
      });

    // Persist recommendations with hydrated title + year.
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

    // Update session row with merged history, follow-ups, usage, status.
    const allMessages = [...priorMessages, ...newMessages];
    const [prev] = await db.select().from(session).where(eq(session.id, sessionId));
    const followUps = [...(prev?.followUpSuggestions ?? [])];
    while (followUps.length < cycle) followUps.push(null);
    const followUp = output.follow_up_suggestion ?? null;
    followUps[cycle] = followUp;

    const playlistTitles = [...(prev?.playlistTitles ?? [])];
    while (playlistTitles.length < cycle) playlistTitles.push(null);
    const playlistTitle = output.playlist_title ?? null;
    playlistTitles[cycle] = playlistTitle;

    const playlistSummaries = [...(prev?.playlistSummaries ?? [])];
    while (playlistSummaries.length < cycle) playlistSummaries.push(null);
    const playlistSummary = output.playlist_summary ?? null;
    playlistSummaries[cycle] = playlistSummary;

    const allStepTexts = [
      ...(prev?.stepTexts ?? []),
      ...stepTexts.map((s) => ({ cycle, turn: s.turn, text: s.text })),
    ];

    await db
      .update(session)
      .set({
        status: 'complete',
        latencyMs: Date.now() - t0,
        inputTokens: (prev?.inputTokens ?? 0) + inputTokens,
        outputTokens: (prev?.outputTokens ?? 0) + outputTokens,
        toolCallsN: (prev?.toolCallsN ?? 0) + toolCallsCount,
        followUpSuggestions: followUps,
        playlistTitles,
        playlistSummaries,
        messages: allMessages,
        stepTexts: allStepTexts,
      })
      .where(eq(session.id, sessionId));

    // Hydrate recommendations_ready payload so SessionView can pop them straight
    // into state without a router.refresh() round-trip.
    const recRows = await db
      .select()
      .from(recommendation)
      .where(eq(recommendation.sessionId, sessionId))
      .orderBy(recommendation.position);
    const newCycleRecs = recRows.filter((r) => r.cycle === cycle);
    const recKeys = newCycleRecs.map((r) => r.plexRatingKey);
    const movies = recKeys.length
      ? await db.select().from(movie).where(inArray(movie.ratingKey, recKeys))
      : [];
    const byKey = new Map(movies.map((m) => [m.ratingKey, m]));
    const machineId = await getMachineIdentifier();
    const hydrated = newCycleRecs.map((r) => {
      const m = byKey.get(r.plexRatingKey);
      return {
        id: r.id,
        cycle: r.cycle,
        position: r.position,
        ratingKey: r.plexRatingKey,
        title: m?.title ?? r.title,
        year: m?.year ?? r.year,
        genres: m?.genres ?? [],
        runtimeMin: m?.durationMin ?? null,
        audienceRating: m?.audienceRating ?? null,
        directors: m?.directors ?? [],
        topCast: (m?.topCast ?? []).slice(0, 3),
        reasoning: r.reasoning,
        group: r.group,
        feedback: r.feedback,
        playUrl: machineId ? buildPlayUrl(machineId, r.plexRatingKey) : null,
      };
    });

    bus.publish(sessionId, {
      type: 'recommendations_ready',
      data: { cycle, recommendations: hydrated, followUpSuggestion: followUp },
    });
    bus.publish(sessionId, { type: 'done', data: {} });
    log.info(
      {
        elapsedMs: Date.now() - t0,
        recCount: hydrated.length,
        toolCalls: toolCallsCount,
        inputTokens,
        outputTokens,
      },
      'cycle complete',
    );
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
    log.error({ err, elapsedMs: Date.now() - t0 }, 'cycle failed');
  }
}
