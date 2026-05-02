import { notFound } from 'next/navigation';
import { getSessionDetail } from '@/lib/sessions/queries';
import { db } from '@/lib/db/client';
import { movie } from '@/lib/db/schema';
import { inArray } from 'drizzle-orm';
import { buildPlayUrl, getMachineIdentifier } from '@/lib/plex';
import SessionView, { type SessionViewData } from '@/components/session';

export const dynamic = 'force-dynamic';

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getSessionDetail(id);
  if (!detail) notFound();

  const ratingKeys = Array.from(
    new Set(detail.recommendations.map((r) => r.plexRatingKey)),
  );
  const [movies, machineId] = await Promise.all([
    ratingKeys.length
      ? db.select().from(movie).where(inArray(movie.ratingKey, ratingKeys))
      : Promise.resolve([]),
    getMachineIdentifier(),
  ]);
  const byKey = new Map(movies.map((m) => [m.ratingKey, m]));

  const data: SessionViewData = {
    id: detail.session.id,
    status: detail.session.status,
    userPrompt: detail.session.userPrompt,
    prompts: detail.session.prompts,
    errorMessage: detail.session.errorMessage,
    followUpSuggestions: detail.session.followUpSuggestions,
    recommendations: detail.recommendations.map((r) => {
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
    }),
    toolCalls: detail.toolCalls.map((t) => ({
      id: t.id,
      cycle: t.cycle,
      turn: t.turn,
      toolName: t.toolName,
      toolInput: t.toolInput as Record<string, unknown>,
      durationMs: t.durationMs ?? 0,
    })),
    stepTexts: detail.session.stepTexts ?? [],
  };

  return <SessionView initial={data} />;
}
