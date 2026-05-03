import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestDb, type TestDb } from '@/test/db';

let testDb: TestDb;

vi.mock('@/lib/db/client', () => ({
  get db() {
    return testDb;
  },
}));

import { recommendation, session } from '@/lib/db/schema';
import { buildFeedbackNote } from '@/lib/feedback-note';

beforeAll(async () => {
  const { db } = await makeTestDb();
  testDb = db;
});

beforeEach(async () => {
  await testDb.delete(recommendation);
  await testDb.delete(session);
});

async function makeSession(): Promise<string> {
  const [row] = await testDb
    .insert(session)
    .values({
      userPrompt: 'p',
      prompts: ['p'],
      status: 'complete',
    })
    .returning({ id: session.id });
  return row.id;
}

async function seedRec(opts: {
  sessionId: string;
  ratingKey: string;
  title: string;
  year?: number | null;
  feedback: 'up' | 'down' | 'watched' | 'none';
  feedbackAt?: Date | null;
}): Promise<void> {
  await testDb.insert(recommendation).values({
    sessionId: opts.sessionId,
    cycle: 0,
    position: 0,
    plexRatingKey: opts.ratingKey,
    title: opts.title,
    year: opts.year ?? null,
    reasoning: 'because',
    feedback: opts.feedback,
    feedbackAt: opts.feedbackAt ?? null,
  });
}

describe('buildFeedbackNote', () => {
  it('returns empty string when no feedback exists', async () => {
    expect(await buildFeedbackNote()).toBe('');
  });

  it('returns empty string when only "none" feedback exists', async () => {
    const sid = await makeSession();
    await seedRec({
      sessionId: sid,
      ratingKey: 'r1',
      title: 'X',
      feedback: 'none',
    });
    expect(await buildFeedbackNote()).toBe('');
  });

  it('groups by feedback type and includes year', async () => {
    const sid = await makeSession();
    await seedRec({
      sessionId: sid,
      ratingKey: 'r1',
      title: 'Liked Pick',
      year: 2020,
      feedback: 'up',
      feedbackAt: new Date('2026-04-01'),
    });
    await seedRec({
      sessionId: sid,
      ratingKey: 'r2',
      title: 'Disliked Pick',
      year: 2019,
      feedback: 'down',
      feedbackAt: new Date('2026-04-02'),
    });
    await seedRec({
      sessionId: sid,
      ratingKey: 'r3',
      title: 'Watched Pick',
      year: 2021,
      feedback: 'watched',
      feedbackAt: new Date('2026-04-03'),
    });

    const note = await buildFeedbackNote();
    expect(note).toContain('Liked: Liked Pick (2020)');
    expect(note).toContain('Disliked: Disliked Pick (2019)');
    expect(note).toContain('Watched after recommendation: Watched Pick (2021)');
    expect(note).toContain('Use these as taste signals');
  });

  it('dedupes by rating_key, keeping the most recent feedback', async () => {
    const sid = await makeSession();
    // Same rating_key, two recs — most recent feedbackAt wins.
    await seedRec({
      sessionId: sid,
      ratingKey: 'r1',
      title: 'The Movie',
      year: 2020,
      feedback: 'down',
      feedbackAt: new Date('2026-01-01'),
    });
    await seedRec({
      sessionId: sid,
      ratingKey: 'r1',
      title: 'The Movie',
      year: 2020,
      feedback: 'up',
      feedbackAt: new Date('2026-04-01'),
    });
    const note = await buildFeedbackNote();
    expect(note).toContain('Liked: The Movie');
    expect(note).not.toContain('Disliked: The Movie');
  });

  it('caps at maxEntries', async () => {
    const sid = await makeSession();
    for (let i = 0; i < 40; i++) {
      await seedRec({
        sessionId: sid,
        ratingKey: `r${i}`,
        title: `Title ${i}`,
        feedback: 'up',
        feedbackAt: new Date(2026, 0, i + 1),
      });
    }
    const note = await buildFeedbackNote(5);
    // Just check it didn't include all 40 by counting occurrences.
    const titleHits = (note.match(/Title \d+/g) ?? []).length;
    expect(titleHits).toBe(5);
  });

  it('omits a row whose feedbackAt is null', async () => {
    const sid = await makeSession();
    // 'up' but null feedbackAt — buildFeedbackNote skips it.
    await seedRec({
      sessionId: sid,
      ratingKey: 'r1',
      title: 'No Time',
      feedback: 'up',
      feedbackAt: null,
    });
    expect(await buildFeedbackNote()).toBe('');
  });
});
