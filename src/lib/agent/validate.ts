import { getMoviesByKeys } from '@/lib/catalog';
import type { RecommendationOutputT } from './output';

const EMPTY_PICKS_NUDGE =
  'You submitted zero recommendations. Use the catalog tools to find candidates ' +
  'and reply with the JSON object specified in the system prompt — at least one ' +
  'recommendation, with rating_keys taken directly from prior tool results.';

const HALLUCINATED_KEYS_NUDGE =
  'None of the rating_keys you submitted exist in the catalog. ' +
  'Run search_movies (or the other lookup tools) and pick rating_keys directly ' +
  'from those tool results, then submit recommendations again.';

export interface ValidationResult {
  ok: boolean;
  cleaned?: RecommendationOutputT;
  retryMessage?: string;
  dropped: string[];
}

export async function validateRecommendations(
  output: RecommendationOutputT,
): Promise<ValidationResult> {
  const candidateKeys = output.recommendations
    .map((r) => r.rating_key.trim())
    .filter(Boolean);

  if (candidateKeys.length === 0) {
    return { ok: false, retryMessage: EMPTY_PICKS_NUDGE, dropped: [] };
  }

  const known = await getMoviesByKeys(candidateKeys);
  const knownSet = new Set(known.map((m) => m.ratingKey));

  const cleaned: RecommendationOutputT['recommendations'] = [];
  const dropped: string[] = [];

  for (const r of output.recommendations) {
    const rk = r.rating_key.trim();
    if (!rk) continue;
    if (!knownSet.has(rk)) {
      dropped.push(rk);
      continue;
    }
    const group = r.group?.trim() || null;
    cleaned.push({ rating_key: rk, reasoning: r.reasoning, group });
  }

  if (cleaned.length === 0) {
    return { ok: false, retryMessage: HALLUCINATED_KEYS_NUDGE, dropped };
  }

  const followUp = output.follow_up_suggestion?.trim().slice(0, 120) || null;
  const playlistTitle = output.playlist_title.trim().slice(0, 60);
  const playlistSummary = output.playlist_summary.trim().slice(0, 280);

  return {
    ok: true,
    cleaned: {
      recommendations: cleaned,
      follow_up_suggestion: followUp,
      playlist_title: playlistTitle,
      playlist_summary: playlistSummary,
    },
    dropped,
  };
}
