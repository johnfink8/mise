import {
  and,
  arrayContains,
  arrayOverlaps,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  gte,
  inArray,
  lte,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { db } from './db/client';
import {
  catalogState,
  collection as collectionTable,
  movie,
  movieEmbedding,
} from './db/schema';
import { buildEmbeddingText, embed, embedMany, vectorLiteral } from './embeddings';
import { logger } from './logger';
import {
  enrichWithFullMetadata,
  listCollections,
  listMovies,
  type PlexMovie,
} from './plex';

const log = logger.child({ component: 'catalog' });

export type LoadingPhase =
  | 'fetching_movies'
  | 'fetching_collections'
  | 'persisting'
  | 'embedding';

export interface LoadingState {
  phase: LoadingPhase;
  startedAt: number;
  progress: { done: number; total: number } | null;
}

interface RefreshResult {
  count: number;
}

let refreshPromise: Promise<RefreshResult> | null = null;
let loadingState: LoadingState | null = null;

export function getLoadingState(): LoadingState | null {
  return loadingState;
}

export async function dataAgeSeconds(): Promise<number | null> {
  const [row] = await db.select().from(catalogState).where(eq(catalogState.id, 1));
  if (!row?.lastRefreshAt) return null;
  return Math.floor((Date.now() - row.lastRefreshAt.getTime()) / 1000);
}

export async function movieCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(movie);
  return row?.n ?? 0;
}

export async function embeddedCount(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(movieEmbedding);
  return row?.n ?? 0;
}

export function refreshFromPlex(opts: { force?: boolean } = {}): Promise<RefreshResult> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      if (!opts.force) {
        const age = await dataAgeSeconds();
        if (age !== null && age < 60 * 60 * 24) {
          return { count: await movieCount() };
        }
      }
      return await runRefresh();
    } finally {
      refreshPromise = null;
      loadingState = null;
    }
  })();
  return refreshPromise;
}

async function runRefresh(): Promise<RefreshResult> {
  const t0 = Date.now();
  log.info('refresh start');

  loadingState = { phase: 'fetching_movies', startedAt: Date.now(), progress: null };
  let phaseT = Date.now();
  const bulk = await listMovies();
  log.info({ count: bulk.length, elapsedMs: Date.now() - phaseT }, 'bulk list done');

  // Plex's bulk /sections/{id}/all caps each movie's cast at 3 entries; per-movie
  // /library/metadata/{key} returns the full ~15. Refetch in parallel so the
  // catalog has searchable cast for everyone, not just top-billed.
  loadingState = {
    phase: 'fetching_movies',
    startedAt: loadingState.startedAt,
    progress: { done: 0, total: bulk.length },
  };
  phaseT = Date.now();
  const movies = await enrichWithFullMetadata(bulk, {
    concurrency: 16,
    onProgress: (done, total) => {
      loadingState = {
        phase: 'fetching_movies',
        startedAt: loadingState?.startedAt ?? Date.now(),
        progress: { done, total },
      };
    },
  });
  log.info({ count: movies.length, elapsedMs: Date.now() - phaseT }, 'enrich metadata done');

  loadingState = { phase: 'fetching_collections', startedAt: Date.now(), progress: null };
  phaseT = Date.now();
  const collections = await listCollections();
  log.info(
    { count: collections.length, elapsedMs: Date.now() - phaseT },
    'fetch collections done',
  );

  loadingState = {
    phase: 'persisting',
    startedAt: Date.now(),
    progress: { done: 0, total: movies.length + collections.length },
  };
  phaseT = Date.now();
  await persistMovies(movies);
  await persistCollections(collections);
  log.info({ elapsedMs: Date.now() - phaseT }, 'persist done');

  loadingState = { phase: 'embedding', startedAt: Date.now(), progress: { done: 0, total: 0 } };
  phaseT = Date.now();
  await syncEmbeddings(movies);
  log.info({ elapsedMs: Date.now() - phaseT }, 'embedding sync done');

  await db
    .insert(catalogState)
    .values({ id: 1, lastRefreshAt: new Date() })
    .onConflictDoUpdate({ target: catalogState.id, set: { lastRefreshAt: new Date() } });

  log.info({ count: movies.length, totalMs: Date.now() - t0 }, 'refresh done');
  return { count: movies.length };
}

async function persistMovies(movies: PlexMovie[]): Promise<void> {
  if (movies.length === 0) return;
  const rows = movies.map((m) => ({
    ratingKey: m.ratingKey,
    title: m.title,
    year: m.year,
    genres: m.genres,
    summary: m.summary,
    audienceRating: m.audienceRating,
    contentRating: m.contentRating,
    durationMin: m.durationMin,
    directors: m.directors,
    topCast: m.topCast,
    viewCount: m.viewCount,
    lastViewedAt: m.lastViewedAt,
    addedAt: m.addedAt,
    collections: m.collections,
    thumb: m.thumb,
    updatedAt: new Date(),
  }));
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await db
      .insert(movie)
      .values(chunk)
      .onConflictDoUpdate({
        target: movie.ratingKey,
        set: {
          title: sql`excluded.title`,
          year: sql`excluded.year`,
          genres: sql`excluded.genres`,
          summary: sql`excluded.summary`,
          audienceRating: sql`excluded.audience_rating`,
          contentRating: sql`excluded.content_rating`,
          durationMin: sql`excluded.duration_min`,
          directors: sql`excluded.directors`,
          topCast: sql`excluded.top_cast`,
          viewCount: sql`excluded.view_count`,
          lastViewedAt: sql`excluded.last_viewed_at`,
          addedAt: sql`excluded.added_at`,
          collections: sql`excluded.collections`,
          thumb: sql`excluded.thumb`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
}

async function persistCollections(
  collections: { name: string; size: number; ratingKeys: string[] }[],
): Promise<void> {
  await db.delete(collectionTable);
  if (collections.length === 0) return;
  await db.insert(collectionTable).values(
    collections.map((c) => ({
      name: c.name,
      size: c.size,
      ratingKeys: c.ratingKeys,
      updatedAt: new Date(),
    })),
  );
}

async function syncEmbeddings(movies: PlexMovie[]): Promise<void> {
  const haveRows = await db
    .select({ ratingKey: movieEmbedding.ratingKey })
    .from(movieEmbedding);
  const have = new Set(haveRows.map((r) => r.ratingKey));
  const todo = movies.filter((m) => !have.has(m.ratingKey));
  if (todo.length === 0) return;

  loadingState = {
    phase: 'embedding',
    startedAt: loadingState?.startedAt ?? Date.now(),
    progress: { done: 0, total: todo.length },
  };
  const batch = 16;
  for (let i = 0; i < todo.length; i += batch) {
    const slice = todo.slice(i, i + batch);
    const vecs = await embedMany(slice.map(buildEmbeddingText));
    const rows = slice.map((m, j) => ({
      ratingKey: m.ratingKey,
      embedding: vecs[j],
      updatedAt: new Date(),
    }));
    await db
      .insert(movieEmbedding)
      .values(rows)
      .onConflictDoUpdate({
        target: movieEmbedding.ratingKey,
        set: {
          embedding: sql`excluded.embedding`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    loadingState = {
      phase: 'embedding',
      startedAt: loadingState?.startedAt ?? Date.now(),
      progress: { done: Math.min(i + batch, todo.length), total: todo.length },
    };
  }
}

export async function getMovie(ratingKey: string) {
  const [row] = await db.select().from(movie).where(eq(movie.ratingKey, ratingKey));
  return row ?? null;
}

export async function getMoviesByKeys(ratingKeys: string[]) {
  if (ratingKeys.length === 0) return [];
  return db.select().from(movie).where(inArray(movie.ratingKey, ratingKeys));
}

export async function getCollections() {
  return db.select().from(collectionTable).orderBy(collectionTable.name);
}

export async function userHistory(
  opts: { limit?: number; sort?: 'recent' | 'most_watched' } = {},
) {
  const limit = opts.limit ?? 20;
  const order =
    opts.sort === 'most_watched' ? desc(movie.viewCount) : desc(movie.lastViewedAt);
  return db
    .select()
    .from(movie)
    .where(gt(movie.viewCount, 0))
    .orderBy(order)
    .limit(limit);
}

export interface SearchFilters {
  query?: string;
  genres?: string[];
  yearMin?: number;
  yearMax?: number;
  cast?: string;
  director?: string;
  maxRuntime?: number;
  minAudienceRating?: number;
  watchedStatus?: 'watched' | 'unwatched' | 'any';
  inCollection?: string;
  addedAfter?: string;
  sort?: 'recent_added' | 'popularity' | 'rating';
  limit?: number;
}

export interface SearchResult {
  count: number;
  totalMatches: number;
  rankedBy: 'query_similarity' | 'popularity' | 'rating' | 'recent_added';
  results: {
    ratingKey: string;
    title: string;
    year: number | null;
    genres: string[];
    runtimeMin: number | null;
    audienceRating: number | null;
    viewCount: number;
  }[];
}

function likePattern(s: string): string {
  return '%' + s.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}

function buildSearchWhere(filters: SearchFilters): SQL | undefined {
  const conds: SQL[] = [];
  if (filters.genres?.length) conds.push(arrayOverlaps(movie.genres, filters.genres));
  if (filters.yearMin !== undefined) conds.push(gte(movie.year, filters.yearMin));
  if (filters.yearMax !== undefined) conds.push(lte(movie.year, filters.yearMax));
  if (filters.cast) {
    conds.push(
      sql`EXISTS (SELECT 1 FROM unnest(${movie.topCast}) c WHERE c ILIKE ${likePattern(filters.cast)} ESCAPE '\\')`,
    );
  }
  if (filters.director) {
    conds.push(
      sql`EXISTS (SELECT 1 FROM unnest(${movie.directors}) d WHERE d ILIKE ${likePattern(filters.director)} ESCAPE '\\')`,
    );
  }
  if (filters.maxRuntime !== undefined) conds.push(lte(movie.durationMin, filters.maxRuntime));
  if (filters.minAudienceRating !== undefined) {
    conds.push(gte(movie.audienceRating, filters.minAudienceRating));
  }
  if (filters.watchedStatus === 'watched') conds.push(gt(movie.viewCount, 0));
  if (filters.watchedStatus === 'unwatched') conds.push(eq(movie.viewCount, 0));
  if (filters.inCollection) {
    conds.push(arrayContains(movie.collections, [filters.inCollection]));
  }
  if (filters.addedAfter) conds.push(gte(movie.addedAt, new Date(filters.addedAfter)));
  return conds.length ? and(...conds) : undefined;
}

export async function search(filters: SearchFilters): Promise<SearchResult> {
  const limit = Math.min(filters.limit ?? 100, 250);
  const where = buildSearchWhere(filters);

  const [totalRow] = await db
    .select({ n: count() })
    .from(movie)
    .where(where);
  const totalMatches = totalRow?.n ?? 0;

  let rankedBy: SearchResult['rankedBy'];
  let rows: (typeof movie.$inferSelect)[];

  if (filters.query) {
    rankedBy = 'query_similarity';
    const qvec = vectorLiteral(await embed(filters.query));
    // pgvector HNSW + WHERE clause needs iterative_scan, otherwise the index
    // returns the top ef_search (~40) candidates and THEN applies the filter,
    // which can give us far fewer than `limit` results. SET LOCAL scopes it
    // to this transaction.
    rows = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL hnsw.iterative_scan = strict_order`);
      return tx
        .select(getTableColumns(movie))
        .from(movie)
        .innerJoin(movieEmbedding, eq(movieEmbedding.ratingKey, movie.ratingKey))
        .where(where)
        .orderBy(sql`${movieEmbedding.embedding} <=> ${qvec}::vector`)
        .limit(limit);
    });
  } else {
    const sort = filters.sort ?? 'popularity';
    const order =
      sort === 'recent_added'
        ? desc(movie.addedAt)
        : sort === 'rating'
        ? desc(movie.audienceRating)
        : desc(movie.viewCount);
    rankedBy =
      sort === 'recent_added' ? 'recent_added' : sort === 'rating' ? 'rating' : 'popularity';
    rows = await db.select().from(movie).where(where).orderBy(order).limit(limit);
  }

  return {
    count: rows.length,
    totalMatches,
    rankedBy,
    results: rows.map((m) => ({
      ratingKey: m.ratingKey,
      title: m.title,
      year: m.year,
      genres: m.genres,
      runtimeMin: m.durationMin,
      audienceRating: m.audienceRating,
      viewCount: m.viewCount,
    })),
  };
}

export async function similarTo(ratingKey: string, k = 10) {
  const seed = alias(movieEmbedding, 'seed');
  const peer = alias(movieEmbedding, 'peer');
  const distance = sql<number>`(${peer.embedding} <=> ${seed.embedding})::float`;
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL hnsw.iterative_scan = strict_order`);
    return tx
      .select({
        ...getTableColumns(movie),
        distance: distance.as('distance'),
      })
      .from(seed)
      .innerJoin(peer, ne(peer.ratingKey, seed.ratingKey))
      .innerJoin(movie, eq(movie.ratingKey, peer.ratingKey))
      .where(eq(seed.ratingKey, ratingKey))
      .orderBy(distance)
      .limit(k);
  });
}

export async function rankByQuery(
  query: string,
  candidateKeys: string[],
  limit: number,
) {
  if (candidateKeys.length === 0) return [];
  const qvec = vectorLiteral(await embed(query));
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL hnsw.iterative_scan = strict_order`);
    return tx
      .select(getTableColumns(movie))
      .from(movie)
      .innerJoin(movieEmbedding, eq(movieEmbedding.ratingKey, movie.ratingKey))
      .where(inArray(movie.ratingKey, candidateKeys))
      .orderBy(sql`${movieEmbedding.embedding} <=> ${qvec}::vector`)
      .limit(limit);
  });
}
