import {
  pgTable,
  pgEnum,
  text,
  integer,
  timestamp,
  real,
  vector,
  uuid,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const sessionStatus = pgEnum('session_status', [
  'pending',
  'running',
  'complete',
  'error',
]);

export const feedback = pgEnum('feedback', ['none', 'up', 'down', 'watched']);

export const movie = pgTable('movie', {
  ratingKey: text('rating_key').primaryKey(),
  title: text('title').notNull(),
  year: integer('year'),
  genres: text('genres').array().notNull().default(sql`'{}'::text[]`),
  summary: text('summary').notNull().default(''),
  audienceRating: real('audience_rating'),
  contentRating: text('content_rating'),
  durationMin: integer('duration_min'),
  directors: text('directors').array().notNull().default(sql`'{}'::text[]`),
  topCast: text('top_cast').array().notNull().default(sql`'{}'::text[]`),
  viewCount: integer('view_count').notNull().default(0),
  lastViewedAt: timestamp('last_viewed_at', { withTimezone: true }),
  addedAt: timestamp('added_at', { withTimezone: true }),
  collections: text('collections').array().notNull().default(sql`'{}'::text[]`),
  thumb: text('thumb'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const movieEmbedding = pgTable(
  'movie_embedding',
  {
    ratingKey: text('rating_key')
      .primaryKey()
      .references(() => movie.ratingKey, { onDelete: 'cascade' }),
    embedding: vector('embedding', { dimensions: 384 }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('movie_embedding_cosine_idx').using(
      'hnsw',
      t.embedding.op('vector_cosine_ops'),
    ),
  ],
);

export const collection = pgTable('collection', {
  name: text('name').primaryKey(),
  size: integer('size').notNull().default(0),
  ratingKeys: text('rating_keys').array().notNull().default(sql`'{}'::text[]`),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  userPrompt: text('user_prompt').notNull(),
  prompts: jsonb('prompts').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  formPayload: jsonb('form_payload').$type<Record<string, unknown> | null>(),
  model: text('model'),
  status: sessionStatus('status').notNull().default('pending'),
  errorMessage: text('error_message'),
  latencyMs: integer('latency_ms'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  toolCallsN: integer('tool_calls_n').notNull().default(0),
  followUpSuggestions: jsonb('follow_up_suggestions')
    .$type<(string | null)[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  playlistTitles: jsonb('playlist_titles')
    .$type<(string | null)[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  messages: jsonb('messages')
    .$type<Array<{ role: string; content: unknown }>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  stepTexts: jsonb('step_texts')
    .$type<Array<{ cycle: number; turn: number; text: string }>>()
    .notNull()
    .default(sql`'[]'::jsonb`),
});

export const recommendation = pgTable(
  'recommendation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    cycle: integer('cycle').notNull(),
    position: integer('position').notNull(),
    plexRatingKey: text('plex_rating_key').notNull(),
    title: text('title').notNull(),
    year: integer('year'),
    reasoning: text('reasoning').notNull(),
    group: text('group'),
    feedback: feedback('feedback').notNull().default('none'),
    feedbackAt: timestamp('feedback_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('recommendation_session_cycle_idx').on(t.sessionId, t.cycle, t.position),
    index('recommendation_rating_key_idx').on(t.plexRatingKey),
  ],
);

export const toolCall = pgTable(
  'tool_call',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => session.id, { onDelete: 'cascade' }),
    cycle: integer('cycle').notNull(),
    turn: integer('turn').notNull(),
    toolName: text('tool_name').notNull(),
    toolInput: jsonb('tool_input').notNull(),
    toolOutput: jsonb('tool_output'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('tool_call_session_cycle_turn_idx').on(t.sessionId, t.cycle, t.turn)],
);

export const catalogState = pgTable('catalog_state', {
  id: integer('id').primaryKey(),
  lastRefreshAt: timestamp('last_refresh_at', { withTimezone: true }),
});
