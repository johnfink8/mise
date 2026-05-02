import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getMoviesByKeys } from '@/lib/catalog';
import type { RecommendationOutputT } from './output';

let cachedNudge: string | null = null;
export async function loadNudge(): Promise<string> {
  if (cachedNudge !== null) return cachedNudge;
  cachedNudge = (
    await readFile(path.join(process.cwd(), 'prompts', 'nudge.md'), 'utf8')
  ).trim();
  return cachedNudge;
}

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
    return { ok: false, retryMessage: await loadNudge(), dropped: [] };
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
    return {
      ok: false,
      retryMessage:
        'None of the rating_keys you submitted exist in the catalog. ' +
        'Run search_movies (or the other lookup tools) and pick rating_keys directly from those tool results, then submit recommendations again.',
      dropped,
    };
  }

  const followUp = output.follow_up_suggestion?.trim().slice(0, 120) || null;

  return {
    ok: true,
    cleaned: { recommendations: cleaned, follow_up_suggestion: followUp },
    dropped,
  };
}
