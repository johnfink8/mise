'use server';

import { z } from 'zod';
import { getSessionDetail } from '@/lib/sessions/queries';
import { upsertMoviePlaylist } from '@/lib/plex';
import { logger } from '@/lib/logger';

const TITLE_PREFIX = 'mise · ';

export interface SavePlaylistResult {
  title: string;
  ratingKey: string;
  deepLink: string | null;
  count: number;
  created: boolean;
}

const Input = z.object({ sessionId: z.string().min(1) });

/**
 * Create-or-update mise's singleton Plex playlist using the latest cycle's
 * recommendations. Discovery is global (by `mise · ` title prefix) — see
 * upsertMoviePlaylist — so any past session's playlist gets rewritten and
 * duplicates are pruned.
 */
export async function savePlaylistAction(
  input: z.input<typeof Input>,
): Promise<SavePlaylistResult> {
  const { sessionId } = Input.parse(input);
  const log = logger.child({ sessionId, action: 'upsert_playlist' });

  const detail = await getSessionDetail(sessionId);
  if (!detail) throw new Error('not found');

  if (detail.recommendations.length === 0) {
    throw new Error('session has no recommendations');
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
    return {
      title: result.title,
      ratingKey: result.ratingKey,
      deepLink: result.deepLink,
      count: ratingKeys.length,
      created: result.created,
    };
  } catch (err) {
    log.warn({ err }, 'plex playlist upsert failed');
    throw err instanceof Error ? err : new Error(String(err));
  }
}
