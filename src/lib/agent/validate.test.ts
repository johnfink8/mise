import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeTestDb, type TestDb } from '@/test/db';

let testDb: TestDb;

vi.mock('@/lib/db/client', () => ({
  get db() {
    return testDb;
  },
}));

import { movie } from '@/lib/db/schema';
import { validateRecommendations } from '@/lib/agent/validate';

beforeAll(async () => {
  const { db } = await makeTestDb();
  testDb = db;
});

beforeEach(async () => {
  await testDb.delete(movie);
});

async function seedKey(rk: string): Promise<void> {
  await testDb.insert(movie).values({
    ratingKey: rk,
    title: `Movie ${rk}`,
    year: 2020,
  });
}

describe('validateRecommendations', () => {
  it('rejects empty recommendations with the empty-picks nudge', async () => {
    const r = await validateRecommendations({
      recommendations: [],
      follow_up_suggestion: null,
      playlist_title: "test list",
    });
    expect(r.ok).toBe(false);
    expect(r.retryMessage).toMatch(/zero recommendations/);
    expect(r.dropped).toEqual([]);
  });

  it('rejects when every key is hallucinated, with the hallucination nudge', async () => {
    const r = await validateRecommendations({
      recommendations: [
        { rating_key: 'fake1', reasoning: '...', group: null },
        { rating_key: 'fake2', reasoning: '...', group: null },
      ],
      follow_up_suggestion: null,
      playlist_title: "test list",
    });
    expect(r.ok).toBe(false);
    expect(r.retryMessage).toMatch(/None of the rating_keys/);
    expect(r.dropped.sort()).toEqual(['fake1', 'fake2']);
  });

  it('drops only the hallucinated rows when some are valid', async () => {
    await seedKey('real1');
    await seedKey('real2');
    const r = await validateRecommendations({
      recommendations: [
        { rating_key: 'real1', reasoning: 'a', group: null },
        { rating_key: 'fake1', reasoning: 'b', group: null },
        { rating_key: 'real2', reasoning: 'c', group: null },
      ],
      follow_up_suggestion: 'shorter',
      playlist_title: 'test list',
    });
    expect(r.ok).toBe(true);
    expect(r.cleaned!.recommendations.map((x) => x.rating_key)).toEqual([
      'real1',
      'real2',
    ]);
    expect(r.dropped).toEqual(['fake1']);
  });

  it('trims rating_keys and group labels', async () => {
    await seedKey('real1');
    const r = await validateRecommendations({
      recommendations: [
        {
          rating_key: '  real1  ',
          reasoning: 'a',
          group: '  Cerebral sci-fi  ',
        },
      ],
      follow_up_suggestion: null,
      playlist_title: "test list",
    });
    expect(r.ok).toBe(true);
    const rec = r.cleaned!.recommendations[0];
    expect(rec.rating_key).toBe('real1');
    expect(rec.group).toBe('Cerebral sci-fi');
  });

  it('drops empty group strings to null', async () => {
    await seedKey('real1');
    const r = await validateRecommendations({
      recommendations: [{ rating_key: 'real1', reasoning: '...', group: '   ' }],
      follow_up_suggestion: null,
      playlist_title: "test list",
    });
    expect(r.cleaned!.recommendations[0].group).toBeNull();
  });

  it('truncates follow_up_suggestion to 120 chars', async () => {
    await seedKey('real1');
    const long = 'x'.repeat(200);
    const r = await validateRecommendations({
      recommendations: [{ rating_key: 'real1', reasoning: '...', group: null }],
      follow_up_suggestion: long,
      playlist_title: "test list",
    });
    expect(r.cleaned!.follow_up_suggestion?.length).toBe(120);
  });

  it('passes follow_up_suggestion null through unchanged', async () => {
    await seedKey('real1');
    const r = await validateRecommendations({
      recommendations: [{ rating_key: 'real1', reasoning: '...', group: null }],
      follow_up_suggestion: null,
      playlist_title: "test list",
    });
    expect(r.cleaned!.follow_up_suggestion).toBeNull();
  });

  it('trims and caps playlist_title at 60 chars', async () => {
    await seedKey('real1');
    const r = await validateRecommendations({
      recommendations: [{ rating_key: 'real1', reasoning: '...', group: null }],
      follow_up_suggestion: null,
      playlist_title: '   ' + 'x'.repeat(120) + '   ',
    });
    expect(r.cleaned!.playlist_title).toBe('x'.repeat(60));
  });
});
