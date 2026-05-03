import { NextResponse } from 'next/server';
import { getSessionDetail } from '@/lib/sessions/queries';
import { upsertMoviePlaylist } from '@/lib/plex';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TITLE_PREFIX = 'mise · ';

/**
 * Create-or-update mise's singleton Plex playlist using the latest cycle's
 * recommendations. Discovery is global (by `mise · ` title prefix) — see
 * upsertMoviePlaylist — so any past session's playlist gets rewritten and
 * duplicates are pruned.
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const log = logger.child({ sessionId: id, action: 'upsert_playlist' });

  const detail = await getSessionDetail(id);
  if (!detail) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (detail.recommendations.length === 0) {
    return NextResponse.json(
      { error: 'session has no recommendations' },
      { status: 400 },
    );
  }

  const latestCycle = Math.max(...detail.recommendations.map((r) => r.cycle));
  const cycleRecs = detail.recommendations
    .filter((r) => r.cycle === latestCycle)
    .sort((a, b) => a.position - b.position);
  const ratingKeys = cycleRecs.map((r) => r.plexRatingKey);

  const agentTitle = (detail.session.playlistTitles ?? [])[latestCycle];
  const baseTitle =
    agentTitle?.trim() ||
    detail.session.userPrompt.replace(/\s+/g, ' ').trim().slice(0, 50);
  const title = TITLE_PREFIX + baseTitle;
  const summary =
    (detail.session.playlistSummaries ?? [])[latestCycle]?.trim() || null;

  try {
    const result = await upsertMoviePlaylist({ title, summary, ratingKeys });
    log.info(
      {
        count: ratingKeys.length,
        playlistRatingKey: result.ratingKey,
        created: result.created,
      },
      result.created ? 'plex playlist created' : 'plex playlist updated',
    );
    return NextResponse.json({
      title: result.title,
      ratingKey: result.ratingKey,
      deepLink: result.deepLink,
      count: ratingKeys.length,
      created: result.created,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err }, 'plex playlist upsert failed');
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
