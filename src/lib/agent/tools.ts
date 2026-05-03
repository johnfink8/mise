import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import {
  getCollections,
  getMovie,
  search,
  similarTo,
  userHistory,
  type SearchFilters,
} from '@/lib/catalog';

interface CompactMovieIn {
  ratingKey: string;
  title: string;
  year: number | null;
  genres: string[];
  audienceRating: number | null;
  viewCount: number;
  durationMin?: number | null;
  runtimeMin?: number | null;
}

const compactMovie = (m: CompactMovieIn) => ({
  rating_key: m.ratingKey,
  title: m.title,
  year: m.year,
  genres: m.genres,
  runtime_min: m.runtimeMin ?? m.durationMin ?? null,
  audience_rating: m.audienceRating,
  view_count: m.viewCount,
});

const fullMovie = (m: {
  ratingKey: string;
  title: string;
  year: number | null;
  genres: string[];
  summary: string;
  audienceRating: number | null;
  contentRating: string | null;
  durationMin: number | null;
  directors: string[];
  topCast: string[];
  viewCount: number;
  lastViewedAt: Date | null;
  addedAt: Date | null;
  collections: string[];
}) => ({
  rating_key: m.ratingKey,
  title: m.title,
  year: m.year,
  genres: m.genres,
  summary: m.summary,
  audience_rating: m.audienceRating,
  content_rating: m.contentRating,
  runtime_min: m.durationMin,
  directors: m.directors,
  top_cast: m.topCast,
  view_count: m.viewCount,
  last_viewed_at: m.lastViewedAt?.toISOString() ?? null,
  added_at: m.addedAt?.toISOString() ?? null,
  collections: m.collections,
});

export const searchMoviesTool = createTool({
  id: 'search_movies',
  description:
    `Search the user's local Plex movie library. Combine any optional filters; all are AND-ed. ` +
    `Use this to discover candidates before recommending. ` +
    `When 'query' is set, results are ranked by semantic similarity (NOT a substring match) and 'sort' is ignored. ` +
    `If total_matches >> count, narrow filters or raise 'limit' rather than re-querying broadly.`,
  inputSchema: z.object({
    query: z
      .string()
      .optional()
      .describe('Natural-language vibe/mood/themes. Ranks by semantic similarity.'),
    genres: z.array(z.string()).optional().describe('Movies must have at least one.'),
    year_min: z.number().int().optional(),
    year_max: z.number().int().optional(),
    cast: z.string().optional().describe('Substring match against the top 10 cast.'),
    director: z.string().optional(),
    max_runtime: z.number().int().optional().describe('Minutes.'),
    min_audience_rating: z.number().optional().describe('Plex audience rating, 0-10.'),
    watched_status: z.enum(['watched', 'unwatched', 'any']).default('any'),
    in_collection: z
      .string()
      .optional()
      .describe('Exact collection name; use list_collections first.'),
    added_after: z.string().optional().describe('ISO 8601 date.'),
    sort: z.enum(['recent_added', 'popularity', 'rating']).default('popularity'),
    limit: z.number().int().min(1).max(250).default(100),
  }),
  outputSchema: z.object({
    count: z.number(),
    total_matches: z.number(),
    ranked_by: z.string(),
    results: z.array(z.any()),
  }),
  execute: async (input) => {
    const filters: SearchFilters = {
      query: input.query,
      genres: input.genres,
      yearMin: input.year_min,
      yearMax: input.year_max,
      cast: input.cast,
      director: input.director,
      maxRuntime: input.max_runtime,
      minAudienceRating: input.min_audience_rating,
      watchedStatus: input.watched_status,
      inCollection: input.in_collection,
      addedAfter: input.added_after,
      sort: input.sort,
      limit: input.limit,
    };
    const r = await search(filters);
    return {
      count: r.count,
      total_matches: r.totalMatches,
      ranked_by: r.rankedBy,
      results: r.results.map(compactMovie),
    };
  },
});

export const getMovieDetailsTool = createTool({
  id: 'get_movie_details',
  description: 'Get full metadata for a single movie by rating_key.',
  inputSchema: z.object({ rating_key: z.string() }),
  outputSchema: z.any(),
  execute: async (input) => {
    const m = await getMovie(input.rating_key);
    if (!m) return { error: `unknown rating_key=${input.rating_key}` };
    return fullMovie(m);
  },
});

export const getUserHistoryTool = createTool({
  id: 'get_user_history',
  description:
    "Return movies the user has watched as a taste signal. sort='recent' (default) or 'most_watched'.",
  inputSchema: z.object({
    limit: z.number().int().min(1).max(100).default(20),
    sort: z.enum(['recent', 'most_watched']).default('recent'),
  }),
  outputSchema: z.object({ count: z.number(), results: z.array(z.any()) }),
  execute: async (input) => {
    const rows = await userHistory({ limit: input.limit, sort: input.sort });
    return { count: rows.length, results: rows.map(compactMovie) };
  },
});

export const getSimilarToTool = createTool({
  id: 'get_similar_to',
  description:
    'Return the k most semantically similar movies to a seed rating_key (cosine over description embeddings).',
  inputSchema: z.object({
    rating_key: z.string(),
    k: z.number().int().min(1).max(25).default(10),
  }),
  outputSchema: z.object({ count: z.number(), results: z.array(z.any()) }),
  execute: async (input) => {
    const rows = await similarTo(input.rating_key, input.k);
    return { count: rows.length, results: rows.map(compactMovie) };
  },
});

export const listCollectionsTool = createTool({
  id: 'list_collections',
  description: "List the user's curated Plex collections.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    count: z.number(),
    results: z.array(z.object({ name: z.string(), size: z.number() })),
  }),
  execute: async () => {
    const rows = await getCollections();
    return {
      count: rows.length,
      results: rows.map((c) => ({ name: c.name, size: c.size })),
    };
  },
});

export const tools = {
  search_movies: searchMoviesTool,
  get_movie_details: getMovieDetailsTool,
  get_user_history: getUserHistoryTool,
  get_similar_to: getSimilarToTool,
  list_collections: listCollectionsTool,
};
