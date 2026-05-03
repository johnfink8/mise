# mise

A Plex movie recommender, named for *mise-en-scène*. Tell it what you're in the mood for in plain language; it picks from your library and explains why.

You might type "something melancholy and European, not too long" and get back a short programme of films from your shelves — each with the synopsis, cast, runtime, the reason it was picked, and a button to play it in Plex. Every recommendation is something you actually own; mise won't suggest things you can't watch.

Follow-up prompts refine or pivot within the same session — "fewer comedies", "actually something from the 70s", "more from this director."

## Prerequisites

- Docker + Docker Compose
- A running Plex Media Server with a movie library
- An [Anthropic API key](https://console.anthropic.com/settings/keys) (billing required)
- Your [Plex token](https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/)

## Get it running

```bash
git clone <repo-url>
cd mise
# Create .env with the four keys below
docker compose up
```

Open [http://localhost:3000](http://localhost:3000). On the first session mise syncs your Plex library — for a few thousand films this takes a minute or two. After that it's quick.

### `.env`

```
PLEX_BASE_URL=http://plex.local:32400
PLEX_TOKEN=<your X-Plex-Token>
ANTHROPIC_API_KEY=<sk-ant-...>
DATABASE_URL=postgres://mise:mise@postgres:5432/mise
```

That's the whole config for normal use. Advanced tuning knobs (token budgets, retry counts, refresh schedule) are in `src/lib/limits.ts` if you ever need to override them.

## Notes

- mise uses a static Plex token — no OAuth flow. The token identifies the account whose library you'll browse.
- Each session keeps the full conversation history, so follow-up prompts can refine, pivot, or build on previous picks without starting over.
- The library re-syncs from Plex once a day in the background, so newly added films show up the next time you ask.

## Built with

Next.js 16, [Mastra](https://mastra.ai)-wrapped Anthropic Claude (Sonnet 4.6), Postgres + pgvector, and `@huggingface/transformers` for in-process embeddings. Single Docker image, no external services beyond Plex and the Anthropic API.

## License

MIT — see [LICENSE](LICENSE).
