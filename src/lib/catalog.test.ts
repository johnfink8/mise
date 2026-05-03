import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEmbed, makeTestDb, type TestDb } from '@/test/db';

let testDb: TestDb;

// Live binding — when `catalog.ts` reads `db`, it gets whatever testDb points
// at, set by beforeAll. The getter avoids initialization-order issues.
vi.mock('@/lib/db/client', () => ({
  get db() {
    return testDb;
  },
}));

// Avoid loading Transformers.js + downloading the bge model in unit tests.
// The fake embed is deterministic so similarTo / rankByQuery ordering tests
// work, but it doesn't carry semantic meaning (which is fine — we're testing
// SQL semantics here, not retrieval quality).
vi.mock('@/lib/embeddings', async () => {
  const actual = await vi.importActual<typeof import('@/lib/embeddings')>(
    '@/lib/embeddings',
  );
  return {
    ...actual,
    embed: vi.fn(async (text: string) => fakeEmbed(text)),
    embedMany: vi.fn(async (texts: string[]) => texts.map(fakeEmbed)),
  };
});

import {
  catalogState,
  collection,
  movie,
  movieEmbedding,
} from '@/lib/db/schema';
import {
  dataAgeSeconds,
  embeddedCount,
  getCollections,
  getMovie,
  getMoviesByKeys,
  movieCount,
  rankByQuery,
  search,
  similarTo,
  userHistory,
} from '@/lib/catalog';

beforeAll(async () => {
  const { db } = await makeTestDb();
  testDb = db;
});

beforeEach(async () => {
  // Wipe between tests within a file. Order matters for FK chains.
  await testDb.delete(movieEmbedding);
  await testDb.delete(movie);
  await testDb.delete(collection);
  await testDb.delete(catalogState);
});

// ---------- fixtures ----------

interface MovieFixture {
  ratingKey: string;
  title: string;
  year: number;
  genres?: string[];
  audienceRating?: number;
  durationMin?: number;
  directors?: string[];
  topCast?: string[];
  viewCount?: number;
  lastViewedAt?: Date;
  addedAt?: Date;
  collections?: string[];
  summary?: string;
  contentRating?: string;
}

async function seedMovies(fixtures: MovieFixture[]): Promise<void> {
  if (fixtures.length === 0) return;
  await testDb.insert(movie).values(
    fixtures.map((f) => ({
      ratingKey: f.ratingKey,
      title: f.title,
      year: f.year,
      genres: f.genres ?? [],
      summary: f.summary ?? '',
      audienceRating: f.audienceRating ?? null,
      contentRating: f.contentRating ?? null,
      durationMin: f.durationMin ?? null,
      directors: f.directors ?? [],
      topCast: f.topCast ?? [],
      viewCount: f.viewCount ?? 0,
      lastViewedAt: f.lastViewedAt ?? null,
      addedAt: f.addedAt ?? null,
      collections: f.collections ?? [],
      thumb: null,
    })),
  );
}

async function seedEmbeddings(
  rows: { ratingKey: string; seed: string }[],
): Promise<void> {
  if (rows.length === 0) return;
  await testDb.insert(movieEmbedding).values(
    rows.map((r) => ({
      ratingKey: r.ratingKey,
      embedding: fakeEmbed(r.seed),
    })),
  );
}

// ---------- counts ----------

describe('movieCount + embeddedCount', () => {
  it('returns 0 on empty catalog', async () => {
    expect(await movieCount()).toBe(0);
    expect(await embeddedCount()).toBe(0);
  });

  it('returns the correct counts after seeding', async () => {
    await seedMovies([
      { ratingKey: '1', title: 'A', year: 2020 },
      { ratingKey: '2', title: 'B', year: 2021 },
      { ratingKey: '3', title: 'C', year: 2022 },
    ]);
    await seedEmbeddings([
      { ratingKey: '1', seed: 'A' },
      { ratingKey: '2', seed: 'B' },
    ]);
    expect(await movieCount()).toBe(3);
    expect(await embeddedCount()).toBe(2);
  });
});

// ---------- dataAgeSeconds ----------

describe('dataAgeSeconds', () => {
  it('returns null when no refresh has run', async () => {
    expect(await dataAgeSeconds()).toBeNull();
  });

  it('returns elapsed seconds since last refresh', async () => {
    const fortySecondsAgo = new Date(Date.now() - 40_000);
    await testDb.insert(catalogState).values({ id: 1, lastRefreshAt: fortySecondsAgo });
    const age = await dataAgeSeconds();
    expect(age).toBeGreaterThanOrEqual(39);
    expect(age).toBeLessThanOrEqual(41);
  });
});

// ---------- single-movie reads ----------

describe('getMovie / getMoviesByKeys', () => {
  beforeEach(async () => {
    await seedMovies([
      { ratingKey: '100', title: 'Arrival', year: 2016 },
      { ratingKey: '200', title: 'Moon', year: 2009 },
    ]);
  });

  it('getMovie returns the row', async () => {
    const m = await getMovie('100');
    expect(m?.title).toBe('Arrival');
  });

  it('getMovie returns null for unknown key', async () => {
    expect(await getMovie('999')).toBeNull();
  });

  it('getMoviesByKeys returns multiple rows', async () => {
    const rows = await getMoviesByKeys(['100', '200', '999']);
    expect(rows.map((r) => r.title).sort()).toEqual(['Arrival', 'Moon']);
  });

  it('getMoviesByKeys handles empty input', async () => {
    expect(await getMoviesByKeys([])).toEqual([]);
  });
});

// ---------- collections ----------

describe('getCollections', () => {
  it('returns rows in name order', async () => {
    await testDb.insert(collection).values([
      { name: 'Zeta', size: 1, ratingKeys: ['1'] },
      { name: 'Alpha', size: 2, ratingKeys: ['1', '2'] },
      { name: 'Mu', size: 0, ratingKeys: [] },
    ]);
    const rows = await getCollections();
    expect(rows.map((r) => r.name)).toEqual(['Alpha', 'Mu', 'Zeta']);
  });
});

// ---------- userHistory ----------

describe('userHistory', () => {
  beforeEach(async () => {
    await seedMovies([
      {
        ratingKey: '1',
        title: 'Recent Watch',
        year: 2020,
        viewCount: 1,
        lastViewedAt: new Date('2026-04-01'),
      },
      {
        ratingKey: '2',
        title: 'Old But Watched',
        year: 2010,
        viewCount: 1,
        lastViewedAt: new Date('2024-01-01'),
      },
      {
        ratingKey: '3',
        title: 'Most Watched',
        year: 2015,
        viewCount: 10,
        lastViewedAt: new Date('2025-06-01'),
      },
      { ratingKey: '4', title: 'Never Watched', year: 2020, viewCount: 0 },
    ]);
  });

  it('excludes movies with viewCount=0', async () => {
    const rows = await userHistory({ limit: 100 });
    expect(rows.map((r) => r.title)).not.toContain('Never Watched');
  });

  it('default sort is by lastViewedAt desc', async () => {
    const rows = await userHistory({ limit: 100 });
    expect(rows.map((r) => r.title)).toEqual([
      'Recent Watch',
      'Most Watched',
      'Old But Watched',
    ]);
  });

  it('sort=most_watched orders by viewCount desc', async () => {
    const rows = await userHistory({ limit: 100, sort: 'most_watched' });
    expect(rows[0].title).toBe('Most Watched');
  });

  it('respects limit', async () => {
    const rows = await userHistory({ limit: 1 });
    expect(rows).toHaveLength(1);
  });
});

// ---------- search ----------

describe('search — structural filters', () => {
  beforeEach(async () => {
    await seedMovies([
      {
        ratingKey: 'a',
        title: 'Sci-Fi Drama',
        year: 2020,
        genres: ['Science Fiction', 'Drama'],
        audienceRating: 8.0,
        durationMin: 120,
        topCast: ['Alice Sample', 'Bob Test'],
        directors: ['Director One'],
        viewCount: 0,
        addedAt: new Date('2026-01-01'),
        collections: ['Best of 2020'],
      },
      {
        ratingKey: 'b',
        title: 'Comedy Romp',
        year: 2015,
        genres: ['Comedy'],
        audienceRating: 6.5,
        durationMin: 90,
        topCast: ['Carol Other'],
        directors: ['Director Two'],
        viewCount: 5,
        addedAt: new Date('2025-06-01'),
      },
      {
        ratingKey: 'c',
        title: 'Old Sci-Fi',
        year: 1980,
        genres: ['Science Fiction'],
        audienceRating: 7.0,
        durationMin: 100,
        topCast: ['Alice Sample'],
        directors: ['Director One'],
        viewCount: 1,
        addedAt: new Date('2024-12-01'),
      },
      {
        ratingKey: 'd',
        title: 'Long Drama',
        year: 2010,
        genres: ['Drama'],
        audienceRating: 9.0,
        durationMin: 180,
        topCast: ['Bob Test'],
        viewCount: 0,
        addedAt: new Date('2026-02-01'),
      },
    ]);
  });

  it('filter by genre returns only matching', async () => {
    const r = await search({ genres: ['Comedy'] });
    expect(r.results.map((x) => x.ratingKey)).toEqual(['b']);
    expect(r.totalMatches).toBe(1);
  });

  it('filter by multiple genres is OR (overlap)', async () => {
    const r = await search({ genres: ['Comedy', 'Drama'] });
    expect(new Set(r.results.map((x) => x.ratingKey))).toEqual(
      new Set(['a', 'b', 'd']),
    );
  });

  it('year_min / year_max bracket', async () => {
    const r = await search({ yearMin: 2000, yearMax: 2019 });
    expect(new Set(r.results.map((x) => x.ratingKey))).toEqual(
      new Set(['b', 'd']),
    );
  });

  it('cast filter is substring + case-insensitive', async () => {
    const r = await search({ cast: 'alice' });
    expect(new Set(r.results.map((x) => x.ratingKey))).toEqual(
      new Set(['a', 'c']),
    );
  });

  it('director filter is substring', async () => {
    const r = await search({ director: 'Two' });
    expect(r.results.map((x) => x.ratingKey)).toEqual(['b']);
  });

  it('max_runtime caps duration', async () => {
    const r = await search({ maxRuntime: 100 });
    expect(new Set(r.results.map((x) => x.ratingKey))).toEqual(
      new Set(['b', 'c']),
    );
  });

  it('min_audience_rating floors rating', async () => {
    const r = await search({ minAudienceRating: 8.0 });
    expect(new Set(r.results.map((x) => x.ratingKey))).toEqual(
      new Set(['a', 'd']),
    );
  });

  it('watched_status=watched returns viewCount>0', async () => {
    const r = await search({ watchedStatus: 'watched' });
    expect(new Set(r.results.map((x) => x.ratingKey))).toEqual(
      new Set(['b', 'c']),
    );
  });

  it('watched_status=unwatched returns viewCount=0', async () => {
    const r = await search({ watchedStatus: 'unwatched' });
    expect(new Set(r.results.map((x) => x.ratingKey))).toEqual(
      new Set(['a', 'd']),
    );
  });

  it('in_collection exact-matches collection name', async () => {
    const r = await search({ inCollection: 'Best of 2020' });
    expect(r.results.map((x) => x.ratingKey)).toEqual(['a']);
  });

  it('added_after filters by date', async () => {
    const r = await search({ addedAfter: '2025-12-01' });
    expect(new Set(r.results.map((x) => x.ratingKey))).toEqual(
      new Set(['a', 'd']),
    );
  });

  it('combines multiple filters with AND', async () => {
    const r = await search({
      genres: ['Drama'],
      minAudienceRating: 8.5,
      watchedStatus: 'unwatched',
    });
    expect(r.results.map((x) => x.ratingKey)).toEqual(['d']);
  });

  it('default sort=popularity orders by viewCount desc', async () => {
    const r = await search({});
    // viewCount: b=5, c=1, a=0, d=0 — within ties, drizzle's order is stable
    // by some internal key; assert just the leader.
    expect(r.results[0].ratingKey).toBe('b');
  });

  it('sort=rating orders by audienceRating desc', async () => {
    const r = await search({ sort: 'rating' });
    expect(r.results.map((x) => x.ratingKey)).toEqual(['d', 'a', 'c', 'b']);
  });

  it('sort=recent_added orders by addedAt desc', async () => {
    const r = await search({ sort: 'recent_added' });
    expect(r.results.map((x) => x.ratingKey)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('limit caps the returned count but totalMatches reports filter cardinality', async () => {
    const r = await search({ limit: 2 });
    expect(r.results).toHaveLength(2);
    expect(r.totalMatches).toBe(4);
  });

  it('includes all expected fields per result', async () => {
    const r = await search({ genres: ['Comedy'] });
    expect(r.results[0]).toMatchObject({
      ratingKey: 'b',
      title: 'Comedy Romp',
      year: 2015,
      genres: ['Comedy'],
      runtimeMin: 90,
      audienceRating: 6.5,
      viewCount: 5,
    });
  });

  it('rankedBy reflects the sort or query mode', async () => {
    const r1 = await search({});
    expect(r1.rankedBy).toBe('popularity');
    const r2 = await search({ sort: 'rating' });
    expect(r2.rankedBy).toBe('rating');
    const r3 = await search({ sort: 'recent_added' });
    expect(r3.rankedBy).toBe('recent_added');
  });
});

// ---------- search with semantic query ----------

describe('search — query (embedding rank)', () => {
  it('rankedBy is query_similarity, results joined to embeddings', async () => {
    await seedMovies([
      { ratingKey: '1', title: 'Alpha', year: 2020, genres: ['Drama'] },
      { ratingKey: '2', title: 'Beta', year: 2021, genres: ['Drama'] },
      { ratingKey: '3', title: 'Gamma', year: 2022, genres: ['Drama'] },
    ]);
    await seedEmbeddings([
      { ratingKey: '1', seed: 'lonely astronaut grief' },
      { ratingKey: '2', seed: 'comedy buddies banter' },
      { ratingKey: '3', seed: 'lonely astronaut grief' },
    ]);
    const r = await search({ query: 'lonely astronaut grief' });
    expect(r.rankedBy).toBe('query_similarity');
    // Movies with matching seed should rank ahead of the comedy. fakeEmbed is
    // deterministic, so whichever of 1/3 comes first is fine — assert that 2
    // is last.
    expect(r.results[r.results.length - 1].ratingKey).toBe('2');
  });

  it('drops movies with no embedding when query is set', async () => {
    await seedMovies([
      { ratingKey: '1', title: 'Has Embedding', year: 2020, genres: ['Drama'] },
      { ratingKey: '2', title: 'No Embedding', year: 2020, genres: ['Drama'] },
    ]);
    await seedEmbeddings([{ ratingKey: '1', seed: 'foo' }]);
    const r = await search({ query: 'foo' });
    expect(r.results.map((x) => x.ratingKey)).toEqual(['1']);
  });
});

// ---------- similarTo ----------

describe('similarTo', () => {
  it('returns peers ordered by cosine distance, excluding the seed', async () => {
    await seedMovies([
      { ratingKey: '1', title: 'Seed', year: 2020 },
      { ratingKey: '2', title: 'Close', year: 2020 },
      { ratingKey: '3', title: 'Far', year: 2020 },
    ]);
    await seedEmbeddings([
      { ratingKey: '1', seed: 'reference vector' },
      { ratingKey: '2', seed: 'reference vector' },
      { ratingKey: '3', seed: 'totally different' },
    ]);
    const rows = await similarTo('1', 5);
    expect(rows.map((r) => r.ratingKey)).not.toContain('1');
    expect(rows[0].ratingKey).toBe('2');
    expect(rows).toHaveLength(2);
  });

  it('returns empty when seed has no embedding', async () => {
    await seedMovies([{ ratingKey: '1', title: 'X', year: 2020 }]);
    const rows = await similarTo('1', 5);
    expect(rows).toEqual([]);
  });
});

// ---------- rankByQuery ----------

describe('rankByQuery', () => {
  it('ranks the candidate subset by similarity to query', async () => {
    await seedMovies([
      { ratingKey: '1', title: 'A', year: 2020 },
      { ratingKey: '2', title: 'B', year: 2020 },
      { ratingKey: '3', title: 'C', year: 2020 },
      { ratingKey: '4', title: 'D', year: 2020 },
    ]);
    await seedEmbeddings([
      { ratingKey: '1', seed: 'target' },
      { ratingKey: '2', seed: 'something else' },
      { ratingKey: '3', seed: 'target' },
      { ratingKey: '4', seed: 'target' },
    ]);
    const rows = await rankByQuery('target', ['1', '2', '3'], 5);
    // 4 should not appear despite matching, because it isn't in the candidate list.
    expect(rows.map((r) => r.ratingKey)).not.toContain('4');
    // 2 should be last (its seed is 'something else').
    expect(rows[rows.length - 1].ratingKey).toBe('2');
    expect(rows).toHaveLength(3);
  });

  it('returns empty for empty candidate list', async () => {
    const rows = await rankByQuery('anything', [], 10);
    expect(rows).toEqual([]);
  });
});
