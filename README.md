# mise

A Plex movie recommender, named for *mise-en-scène*. You describe what you're in the mood for in plain language; an agentic loop powered by Claude searches your Plex library using structured filters and pgvector semantic similarity, then assembles a short programme with reasoning for each pick.

Follow-up prompts refine or pivot the results within the same session.

## How it works

1. You type a prompt — "something melancholy and European, not too long" or "Coen Brothers movies I haven't seen."
2. The backend creates a session and starts an async agentic loop: Claude calls a `search_movies` tool that queries Postgres with structured filters (genre, year, director, cast, rating, collection, watch status) and optionally ranks results by embedding cosine similarity.
3. Claude can make multiple searches, narrowing criteria across turns, before calling `submit_recommendations` with its final picks.
4. Results stream to the UI in real time via SSE. Each recommendation includes the film's synopsis, cast, rating, runtime, reasoning, and a deep link to play it in Plex.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, TypeScript, MUI, Vite, TanStack Query |
| Backend | Python 3.12, FastAPI, SQLAlchemy, Alembic |
| LLM | Anthropic Claude (Sonnet) — tool use + prompt caching |
| Embeddings | fastembed (BAAI/bge-small-en-v1.5, ONNX, in-process) |
| Vector store | Postgres + pgvector |
| Plex | python-plexapi, static X-Plex-Token |
| Container | Multi-stage Docker image (Node build → Python runtime) |

## Prerequisites

- Docker + Docker Compose
- A running Plex Media Server with a movie library
- An [Anthropic API key](https://console.anthropic.com/settings/keys) (billing required)
- Your [Plex token](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)

## Quick start

```bash
git clone <repo-url>
cd mise
cp .env.example .env
# Edit .env — set PLEX_BASE_URL, PLEX_TOKEN, ANTHROPIC_API_KEY
make bootstrap
```

`make bootstrap` installs dependencies, starts Postgres, runs migrations, and starts the backend dev server. Open [http://localhost:8080](http://localhost:8080). On first load the app syncs your Plex library into Postgres — a progress bar shows each phase (fetching movies, fetching collections, indexing embeddings). Large libraries (~5000 films) take about 60–90 seconds on a cold start.

## Configuration

Copy `.env.example` to `.env` and fill in the required values:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | — | `postgresql+psycopg://mise:mise@localhost:5432/mise` |
| `PLEX_BASE_URL` | yes | — | e.g. `http://plex.local:32400` |
| `PLEX_TOKEN` | yes | — | Static X-Plex-Token for your account |
| `ANTHROPIC_API_KEY` | yes | — | Needs billing enabled |
| `ANTHROPIC_MODEL` | no | `claude-sonnet-4-6` | Any Claude model with tool use |
| `CATALOG_TTL_SECONDS` | no | `86400` | How often to re-sync from Plex (seconds) |
| `MAX_RECOMMENDATIONS` | no | `10` | Maximum films returned per session |
| `MAX_LOOP_TURNS` | no | `8` | Agentic loop turn cap |
| `MAX_TOOL_CALLS` | no | `24` | Tool call cap per session |
| `PORT` | no | `8080` | Backend / production port |
| `CORS_ORIGINS` | no | `*` | Restrict in production (comma-separated) |

The `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` variables are used by Docker Compose to provision the database container. If you change them, update `DATABASE_URL` to match.

## Makefile reference

```
make bootstrap      # One-shot local dev setup
make dev            # Start Postgres + backend dev container (hot reload)

make build          # Build production Docker image
make up             # Start production stack (Postgres + app on $PORT)
make down           # Stop production stack
make restart        # down + up

make migrate        # Run Alembic migrations
make db-up          # Start Postgres only
make db-down        # Stop Postgres only

make test           # Run all tests
make test-backend   # pytest
make test-frontend  # Vitest

make lint           # ruff + ESLint
make typecheck      # mypy + tsc

make logs           # Follow compose logs
make ps             # Show running services
make clean          # Destroy all containers and volumes (drops local DB)
```

## Production deployment

```bash
cp .env.example .env   # fill in credentials
make build
make up
```

The single container serves both the API and the compiled SPA. Set `CORS_ORIGINS` to your domain and put a reverse proxy (nginx, Caddy) in front if you want TLS.

## Development

The backend uses [uv](https://github.com/astral-sh/uv) for dependency management. If you want to run it outside Docker:

```bash
cd backend
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload --port 8080
```

## Tests

```bash
make test-backend    # pytest (requires Postgres)
make test-frontend   # Vitest (no external deps)
```

CI runs lint, typecheck, tests, and a Docker build on every push and PR.

## Notes

- **Plex token**: mise uses a static `X-Plex-Token`. There is no OAuth flow — the token identifies the account whose library you want to browse.
- **Library sync**: The catalog is pulled from Plex into Postgres on startup and refreshed every `CATALOG_TTL_SECONDS`. The sync is incremental on the embedding side but a full re-fetch on the Plex side. For libraries over ~2000 films, the first cold-start sync takes a noticeable amount of time; subsequent starts are fast.
- **Embeddings**: Generated in-process via fastembed (ONNX) — no external embedding API. Model weights are downloaded on first run and cached in the container.
- **Follow-ups**: Each session maintains full conversation history. Follow-up prompts resume the same Claude context, so you can refine ("fewer comedies"), pivot ("actually something from the 70s"), or ask for more picks without starting over.

## License

MIT
