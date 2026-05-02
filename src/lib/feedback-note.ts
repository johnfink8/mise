import { desc, ne } from 'drizzle-orm';
import { db } from './db/client';
import { recommendation } from './db/schema';

interface Entry {
  title: string;
  year: number | null;
  feedback: 'up' | 'down' | 'watched';
}

/**
 * Build a short context note describing the user's recent thumbs-up / thumbs-down /
 * watched picks, prepended to the user's prompt so the agent has cross-session memory.
 *
 * Pulls the most recent N feedback entries (deduped by rating_key). Returns '' if none.
 */
export async function buildFeedbackNote(maxEntries = 30): Promise<string> {
  const rows = await db
    .select({
      title: recommendation.title,
      year: recommendation.year,
      feedback: recommendation.feedback,
      ratingKey: recommendation.plexRatingKey,
      feedbackAt: recommendation.feedbackAt,
    })
    .from(recommendation)
    .where(ne(recommendation.feedback, 'none'))
    .orderBy(desc(recommendation.feedbackAt))
    .limit(maxEntries * 3);

  // Dedupe by rating_key, keeping most-recent feedback.
  const seen = new Set<string>();
  const entries: Entry[] = [];
  for (const r of rows) {
    if (!r.feedbackAt) continue;
    if (seen.has(r.ratingKey)) continue;
    seen.add(r.ratingKey);
    if (r.feedback === 'none') continue;
    entries.push({ title: r.title, year: r.year, feedback: r.feedback });
    if (entries.length >= maxEntries) break;
  }

  if (entries.length === 0) return '';

  const liked = entries.filter((e) => e.feedback === 'up');
  const disliked = entries.filter((e) => e.feedback === 'down');
  const watched = entries.filter((e) => e.feedback === 'watched');
  const fmt = (e: Entry) => `${e.title}${e.year ? ` (${e.year})` : ''}`;

  const lines: string[] = ['Context — the user has previously rated these picks:'];
  if (liked.length) lines.push(`- Liked: ${liked.map(fmt).join('; ')}`);
  if (disliked.length) lines.push(`- Disliked: ${disliked.map(fmt).join('; ')}`);
  if (watched.length) lines.push(`- Watched after recommendation: ${watched.map(fmt).join('; ')}`);
  lines.push('Use these as taste signals; do not re-recommend disliked titles.');
  return lines.join('\n');
}

