# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`mise` is a personal movie recommender for a single user's local Plex library. A Mastra-wrapped Anthropic agent (Sonnet 4.5 by default) calls tools that query a Postgres+pgvector mirror of the Plex catalog, then returns a JSON-validated set of recommendations the UI streams back to the browser.

## Common commands

```bash
npm run dev            # Next.js dev server (http://localhost:3000)
npm run build          # Next.js production build (output: 'standalone')
npm run start          # Run the built standalone server

npm run db:up          # Start the pgvector Postgres in docker-compose (port 5433)
npm run db:generate    # drizzle-kit: generate a new migration from schema.ts
npm run db:migrate     # Apply pending migrations against $DATABASE_URL

npm run mastra:dev     # Mastra dev playground for the agent (http://localhost:4111)

npm run test           # Vitest, single run
npm run test:watch     # Vitest, watch mode
npx vitest run path/to/file.test.ts        # one file
npx vitest run -t "substring of test name" # filter by name
```

`docker compose up` brings the whole stack up (postgres → migrate one-shot → app on :3000). `.env` is required (see `.env` for the keys: `PLEX_BASE_URL`, `PLEX_TOKEN`, `ANTHROPIC_API_KEY`, `DATABASE_URL`).

## Architecture

### Request lifecycle

1. **`POST /api/sessions`** → `startSession()` in `src/lib/sessions/run.ts` inserts a session row (status `pending`) and kicks off `runCycle()` in the background. The route returns the `sessionId` immediately.
2. **`GET /api/sessions/[id]/stream`** opens an SSE stream backed by the in-memory `bus` in `src/lib/event-bus.ts`. The bus buffers events so a late-subscribing client still receives the full cycle (started, assistant_text, tool_call_started/completed, recommendations_ready, done).
3. **`runCycle()`** calls `runAgentCycle()` in `src/lib/agent/run.ts`, persists tool calls / recommendations / token usage to Postgres, and publishes events on the bus.
4. **`POST /api/sessions/[id]/messages`** → `continueSession()` reuses the stored `messages` array as `priorMessages`, increments the cycle counter, and runs another `runAgentCycle()`.

The `bus` lives on `globalThis.__miseBus` so HMR doesn't fork it. It is **in-process only** — there is no Redis or pub/sub. Multi-instance deployments would need a different transport.

### The agent loop (`src/lib/agent/run.ts`)

`runAgentCycle()` is the single source of truth for one model conversation turn. It:

- Loads `prompts/system.md` and prepends it as the first message with an Anthropic `cacheControl: { type: 'ephemeral' }` breakpoint. This caches the system prompt **and** the tool schemas (the SDK emits tool defs before the system message), which is the bulk of the prompt size. The Mastra `instructions` field is intentionally left empty so the cache breakpoint is reachable.
- Wraps user input in `<user_request>...</user_request>` and strips any user-supplied closing tags as a prompt-injection mitigation. The system prompt tells the model to treat the contents as untrusted data.
- Streams `agent.stream(...).fullStream` and dispatches on chunk type (`step-start`, `text-delta`, `tool-call`, `tool-result`, `step-finish`) to fire `emit.onText` / `onToolCallStarted` / `onToolCallCompleted` callbacks — these are how `runCycle()` populates the SSE bus and the `tool_call` table.
- Enforces wallclock + token budgets via `AbortController` (`limits.cycleTimeoutMs`, `limits.cycleTokenBudget` in `src/lib/limits.ts`), surfacing a typed `CycleAbortError`.
- After streaming completes, extracts the trailing JSON object from the final assistant text, validates with Zod (`RecommendationOutput`), then calls `validateRecommendations()` to enforce that every `rating_key` came from a real tool result. On any validation failure, appends a corrective user nudge and retries up to `limits.validationRetries` times.
- `stripFinalJsonTail()` removes the recommendations JSON from the streamed text so the narration ribbon never shows the raw blob.

The Mastra dev playground (`src/mastra/index.ts`) constructs its **own** agent instance, with the system prompt set as `instructions` instead. That path forgoes the cache breakpoint and validation-retry loop — use it for prompt tuning, not as a model of the runtime path.

### Catalog & embeddings

- `src/lib/catalog.ts` is the data layer the tools query. `refreshFromPlex()` is idempotent and de-duped via a module-level promise; on first invocation per session (`cycle === 0`) `runCycle()` calls it best-effort.
- `instrumentation.ts` (Next 16 `register` hook) schedules a `node-cron` daily refresh tick at `MISE_CATALOG_CRON` (default `0 4 * * *`, set to `off` to disable). Guard new bootstrapping behind `process.env.NEXT_RUNTIME === 'nodejs'` because this file also loads in the Edge runtime.
- Embeddings: `Xenova/bge-small-en-v1.5` via `@huggingface/transformers`, stored in `movie_embedding.embedding` as `vector(384)` with an HNSW cosine index. `serverExternalPackages` in `next.config.ts` keeps Transformers.js out of the bundler — the Dockerfile separately copies `onnxruntime-node` / `sharp` into the standalone output because the standalone tracer misses native binaries when packages are externalized.

### Database

- Postgres + pgvector. Schema lives in `src/lib/db/schema.ts`; migrations are generated by `drizzle-kit` into `drizzle/`. `scripts/migrate.ts` runs them via `drizzle-orm/postgres-js/migrator`.
- `src/lib/db/client.ts` reuses one `postgres` pool across HMR via `globalThis.__miseSql`.
- Tests **never** hit real Postgres. `src/test/db.ts` exposes `makeTestDb()` which spins up a fresh `@electric-sql/pglite` instance with the `vector` extension and applies the SQL files in `drizzle/` (read in the order from `drizzle/meta/_journal.json`, split on `--> statement-breakpoint`). Each test file gets its own in-memory database; `fakeEmbed()` produces deterministic 384-dim vectors so we don't need to load the Transformers.js model in unit tests.

### Frontend

- Next 16 App Router under `src/app`. UI components live in `src/components/session/`. The session page subscribes to `/api/sessions/[id]/stream` via `useSessionStream.ts` and renders streaming text + tool calls live.
- Tailwind v4 (no config file — directives in `globals.css`). Self-hosted next/font for Inter / Instrument Serif / JetBrains Mono / Space Grotesk via CSS variables.

## Tuning knobs (env vars)

`MISE_CYCLE_TIMEOUT_MS`, `MISE_CYCLE_TOKEN_BUDGET`, `MISE_SESSION_TOKEN_CEILING`, `MISE_VALIDATION_RETRIES`, `MISE_AGENT_MAX_STEPS`, `MISE_THINKING_BUDGET_TOKENS`, `MISE_CATALOG_CRON` — all defined in `src/lib/limits.ts` with defaults tuned for single-user local use on Sonnet 4.5.
