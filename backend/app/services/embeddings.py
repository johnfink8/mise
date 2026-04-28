"""fastembed (ONNX, in-process) embeddings + pgvector storage.

Strategy:
- Each movie has a `content_hash` over (title|year|sorted(genres)|summary).
- On `schedule_sync(movies)`, we compare hashes against `movie_embeddings` and
  re-embed only changed/new rows in batches.
- `similar_to(rating_key, k)` returns nearest neighbours by cosine distance.
"""

from __future__ import annotations

import asyncio
import hashlib
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import TYPE_CHECKING

import structlog
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.config import get_settings
from app.db import SessionLocal
from app.models.movie_embedding import MovieEmbedding
from app.services.plex_client import Movie

if TYPE_CHECKING:
    from fastembed import TextEmbedding

log = structlog.get_logger()

_BATCH_SIZE = 64


def _content_hash(movie: Movie) -> str:
    parts = [
        movie.title,
        str(movie.year or ""),
        "|".join(sorted(movie.genres)),
        (movie.summary or "")[:2000],
    ]
    return hashlib.sha256("\u241f".join(parts).encode("utf-8")).hexdigest()


def _embed_text_for(movie: Movie) -> str:
    genres = ", ".join(movie.genres) if movie.genres else "unknown"
    year = movie.year or "n/a"
    return f"{movie.title} ({year}) [{genres}] {movie.summary or ''}".strip()


@dataclass
class SimilarMovie:
    rating_key: str
    similarity: float


class EmbeddingService:
    def __init__(self, model_name: str) -> None:
        self._model_name = model_name
        self._model: TextEmbedding | None = None
        self._sync_lock = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None
        # Live progress for in-flight syncs. (done, total) of rows being
        # embedded this run, or None when idle. Surfaced via `/api/catalog`
        # so the UI can show a determinate progress bar during cold-start
        # vector-index population.
        self._progress: tuple[int, int] | None = None

    def progress(self) -> tuple[int, int] | None:
        return self._progress

    def _get_model(self) -> TextEmbedding:
        if self._model is None:
            from fastembed import TextEmbedding

            log.info("embeddings.model.loading", model=self._model_name)
            self._model = TextEmbedding(model_name=self._model_name)
            log.info("embeddings.model.ready", model=self._model_name)
        return self._model

    def _embed_sync(self, texts: list[str]) -> list[list[float]]:
        model = self._get_model()
        return [emb.tolist() for emb in model.embed(texts)]

    async def schedule_sync(self, movies: list[Movie]) -> asyncio.Task[None]:
        """Kick off (or replace) a background embedding sync task."""
        if self._task and not self._task.done():
            return self._task
        self._task = asyncio.create_task(self._sync(movies))
        return self._task

    async def _sync(self, movies: list[Movie]) -> None:
        async with self._sync_lock:
            await self._sync_inner(movies)

    async def _sync_inner(self, movies: list[Movie]) -> None:
        if not movies:
            log.info("embeddings.sync.skip", reason="no_movies")
            return
        t0 = time.monotonic()
        async with SessionLocal() as db:
            existing = {
                row.plex_rating_key: row.content_hash
                for row in (await db.execute(select(MovieEmbedding))).scalars().all()
            }
        log.info(
            "embeddings.sync.diff",
            total=len(movies),
            already_embedded=len(existing),
            diff_ms=int((time.monotonic() - t0) * 1000),
        )

        to_embed: list[tuple[Movie, str]] = []
        for m in movies:
            ch = _content_hash(m)
            if existing.get(m.rating_key) != ch:
                to_embed.append((m, ch))

        if not to_embed:
            log.info(
                "embeddings.sync.done",
                embedded=0,
                total=len(movies),
                reason="all_up_to_date",
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
            return

        total_batches = (len(to_embed) + _BATCH_SIZE - 1) // _BATCH_SIZE
        log.info(
            "embeddings.sync.start",
            total=len(movies),
            to_embed=len(to_embed),
            total_batches=total_batches,
            batch_size=_BATCH_SIZE,
            model=self._model_name,
        )
        self._progress = (0, len(to_embed))
        embed_ms_total = 0
        upsert_ms_total = 0
        try:
            for i in range(0, len(to_embed), _BATCH_SIZE):
                batch_idx = i // _BATCH_SIZE + 1
                batch = to_embed[i : i + _BATCH_SIZE]
                texts = [_embed_text_for(m) for m, _ in batch]
                t_embed = time.monotonic()
                try:
                    vectors = await asyncio.to_thread(self._embed_sync, texts)
                except Exception as exc:
                    log.error(
                        "embeddings.batch_failed",
                        error=str(exc),
                        batch_idx=batch_idx,
                        batch_size=len(batch),
                    )
                    continue
                embed_ms = int((time.monotonic() - t_embed) * 1000)
                embed_ms_total += embed_ms

                t_upsert = time.monotonic()
                await self._upsert_batch(batch, vectors)
                upsert_ms = int((time.monotonic() - t_upsert) * 1000)
                upsert_ms_total += upsert_ms

                done = min(i + _BATCH_SIZE, len(to_embed))
                self._progress = (done, len(to_embed))
                log.info(
                    "embeddings.batch_done",
                    batch_idx=batch_idx,
                    of=total_batches,
                    batch_size=len(batch),
                    embed_ms=embed_ms,
                    upsert_ms=upsert_ms,
                    progress=f"{done}/{len(to_embed)}",
                )

            log.info(
                "embeddings.sync.done",
                embedded=len(to_embed),
                total=len(movies),
                embed_ms_total=embed_ms_total,
                upsert_ms_total=upsert_ms_total,
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        finally:
            self._progress = None

    async def _upsert_batch(
        self,
        batch: list[tuple[Movie, str]],
        embeddings: list[list[float]],
    ) -> None:
        if not batch:
            return
        rows = [
            {
                "plex_rating_key": m.rating_key,
                "content_hash": ch,
                "embedding": vec,
            }
            for (m, ch), vec in zip(batch, embeddings, strict=True)
        ]
        async with SessionLocal() as db:
            stmt = pg_insert(MovieEmbedding).values(rows)
            stmt = stmt.on_conflict_do_update(
                index_elements=["plex_rating_key"],
                set_={
                    "content_hash": stmt.excluded.content_hash,
                    "embedding": stmt.excluded.embedding,
                    "embedded_at": stmt.excluded.embedded_at,
                },
            )
            await db.execute(stmt)
            await db.commit()

    async def rank_by_query(
        self, query: str, candidate_keys: list[str], limit: int
    ) -> list[SimilarMovie]:
        """Rank `candidate_keys` by cosine similarity to a natural-language query.

        Embeds the query string once, then asks pgvector to compute distances
        against the candidates' stored embeddings. Returns up to `limit` results,
        closest first. Candidates without an embedding (e.g. just-added movies
        whose sync hasn't run yet) are simply absent from the output.
        """
        if not candidate_keys or not query.strip() or limit <= 0:
            return []
        t0 = time.monotonic()
        [vec] = await asyncio.to_thread(self._embed_sync, [query])
        async with SessionLocal() as db:
            distance = MovieEmbedding.embedding.cosine_distance(vec)
            stmt = (
                select(MovieEmbedding.plex_rating_key, distance.label("distance"))
                .where(MovieEmbedding.plex_rating_key.in_(candidate_keys))
                .order_by(distance)
                .limit(limit)
            )
            rows = (await db.execute(stmt)).all()
        results = [SimilarMovie(rating_key=str(rk), similarity=float(1.0 - dist)) for rk, dist in rows]
        log.info(
            "embeddings.rank_by_query.done",
            candidates=len(candidate_keys),
            returned=len(results),
            limit=limit,
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
        return results

    async def similar_to(self, rating_key: str, k: int = 10) -> list[SimilarMovie]:
        async with SessionLocal() as db:
            seed = (
                await db.execute(
                    select(MovieEmbedding).where(MovieEmbedding.plex_rating_key == rating_key)
                )
            ).scalar_one_or_none()
            if seed is None:
                return []
            distance = MovieEmbedding.embedding.cosine_distance(seed.embedding)
            stmt = (
                select(MovieEmbedding.plex_rating_key, distance.label("distance"))
                .where(MovieEmbedding.plex_rating_key != rating_key)
                .order_by(distance)
                .limit(k)
            )
            rows = (await db.execute(stmt)).all()
            return [
                SimilarMovie(rating_key=str(rk), similarity=float(1.0 - dist))
                for rk, dist in rows
            ]

    async def coverage(self) -> tuple[int, int]:
        """Return (embedded_count, total_movies_in_db)."""
        async with SessionLocal() as db:
            from sqlalchemy import func

            count = (await db.execute(select(func.count(MovieEmbedding.plex_rating_key)))).scalar()
            return int(count or 0), int(count or 0)


@lru_cache
def get_embedding_service() -> EmbeddingService:
    settings = get_settings()
    return EmbeddingService(settings.embedding_model)
