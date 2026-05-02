import { NextResponse } from 'next/server';
import { inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { movie } from '@/lib/db/schema';
import { getSessionDetail } from '@/lib/recommender';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const detail = await getSessionDetail(id);
  if (!detail) return NextResponse.json({ error: 'not found' }, { status: 404 });

  // Hydrate full Plex metadata for each recommendation's rating_key.
  const ratingKeys = Array.from(new Set(detail.recommendations.map((r) => r.plexRatingKey)));
  const movies = ratingKeys.length
    ? await db.select().from(movie).where(inArray(movie.ratingKey, ratingKeys))
    : [];
  const byKey = new Map(movies.map((m) => [m.ratingKey, m]));

  const recsByCycle = new Map<number, ReturnType<typeof toRecOut>[]>();
  const toRecOut = (
    r: (typeof detail.recommendations)[number],
    m: (typeof movies)[number] | undefined,
  ) => ({
    id: r.id,
    cycle: r.cycle,
    position: r.position,
    rating_key: r.plexRatingKey,
    title: m?.title ?? r.title,
    year: m?.year ?? r.year,
    genres: m?.genres ?? [],
    summary: m?.summary ?? '',
    directors: m?.directors ?? [],
    top_cast: (m?.topCast ?? []).slice(0, 3),
    runtime_min: m?.durationMin ?? null,
    content_rating: m?.contentRating ?? null,
    audience_rating: m?.audienceRating ?? null,
    play_url: m ? `/api/thumbs/${m.ratingKey}` : null, // placeholder; real Plex deep link TBD
    reasoning: r.reasoning,
    group: r.group,
    feedback: r.feedback,
    feedback_at: r.feedbackAt,
  });

  for (const r of detail.recommendations) {
    const arr = recsByCycle.get(r.cycle) ?? [];
    arr.push(toRecOut(r, byKey.get(r.plexRatingKey)));
    recsByCycle.set(r.cycle, arr);
  }

  const toolByCycle = new Map<number, typeof detail.toolCalls>();
  for (const t of detail.toolCalls) {
    const arr = toolByCycle.get(t.cycle) ?? [];
    arr.push(t);
    toolByCycle.set(t.cycle, arr);
  }

  const cycles = [...new Set([...recsByCycle.keys(), ...toolByCycle.keys()])].sort();

  return NextResponse.json({
    id: detail.session.id,
    created_at: detail.session.createdAt,
    status: detail.session.status,
    user_prompt: detail.session.userPrompt,
    prompts: detail.session.prompts,
    error_message: detail.session.errorMessage,
    latency_ms: detail.session.latencyMs,
    input_tokens: detail.session.inputTokens,
    output_tokens: detail.session.outputTokens,
    tool_calls_n: detail.session.toolCallsN,
    follow_up_suggestions: detail.session.followUpSuggestions,
    recommendations: cycles.map((c) => ({ cycle: c, items: recsByCycle.get(c) ?? [] })),
    tool_calls: cycles.map((c) => ({
      cycle: c,
      items: (toolByCycle.get(c) ?? []).map((t) => ({
        id: t.id,
        cycle: t.cycle,
        turn: t.turn,
        tool_name: t.toolName,
        tool_input: t.toolInput,
        tool_output: t.toolOutput,
        duration_ms: t.durationMs,
        created_at: t.createdAt,
      })),
    })),
  });
}

