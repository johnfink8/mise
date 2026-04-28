"""Postgres-backed access to the movie catalog.

The catalog lives in `catalog_movie` and `catalog_collection`. Tools and the
recommender query Postgres directly — there's no in-memory mirror. A bench
(see git history for `scripts/bench_catalog.py`) showed the in-memory dict
saved ~5ms/session on a 5k-movie library, which doesn't justify the
two-source-of-truth complexity.

`refresh_from_plex(force=False)` is the single point that pulls from Plex and
upserts into Postgres. A single-flight `asyncio.Lock` keeps concurrent calls
from doing duplicate work. Freshness is `MAX(updated_at)` on `catalog_movie`,
compared against `CATALOG_TTL_SECONDS`.
"""

from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime
from functools import lru_cache
from typing import Any

import sqlalchemy as sa
import structlog
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.config import get_settings
from app.db import SessionLocal
from app.models.catalog_collection import CatalogCollection
from app.models.catalog_movie import CatalogMovie
from app.services.plex_client import Collection, Movie, PlexClient, get_plex_client

log = structlog.get_logger()


def _row_to_movie(row: CatalogMovie) -> Movie:
    return Movie(
        rating_key=row.plex_rating_key,
        title=row.title,
        year=row.year,
        genres=tuple(row.genres or []),
        summary=row.summary or "",
        audience_rating=row.audience_rating,
        content_rating=row.content_rating,
        duration_min=row.duration_min,
        directors=tuple(row.directors or []),
        top_cast=tuple(row.top_cast or []),
        view_count=row.view_count or 0,
        last_viewed_at=row.last_viewed_at,
        added_at=row.added_at,
        collections=tuple(row.collections_list or []),
        thumb=row.thumb,
    )


def _movie_to_row(m: Movie, now: datetime) -> dict[str, Any]:
    return {
        "plex_rating_key": m.rating_key,
        "title": m.title,
        "year": m.year,
        "genres": list(m.genres),
        "summary": m.summary,
        "audience_rating": m.audience_rating,
        "content_rating": m.content_rating,
        "duration_min": m.duration_min,
        "directors": list(m.directors),
        "top_cast": list(m.top_cast),
        "view_count": m.view_count,
        "last_viewed_at": m.last_viewed_at,
        "added_at": m.added_at,
        "collections_list": list(m.collections),
        "thumb": m.thumb,
        "last_seen_at": now,
        "updated_at": now,
    }


CatalogPhase = str  # "fetching_movies" | "fetching_collections" | "persisting"


class CatalogService:
    def __init__(self, plex: PlexClient, ttl_seconds: int) -> None:
        self._plex = plex
        self._ttl = ttl_seconds
        self._refresh_lock = asyncio.Lock()
        # Live refresh state, surfaced via `/api/catalog` so the UI can show a
        # "loading library" state while a cold start is hydrating from Plex.
        self._refresh_phase: CatalogPhase | None = None
        self._refresh_started_at: float | None = None
        # (done, total) for the current phase, when a phase can report it.
        # Set by the plex_client callbacks during fetch phases and by the
        # persist loop. None during phases that don't report progress.
        self._phase_progress: tuple[int, int] | None = None

    def refresh_state(self) -> dict[str, Any] | None:
        """Returns the current refresh phase + elapsed seconds + per-phase
        progress, or None if idle."""
        if self._refresh_phase is None:
            return None
        elapsed = (
            int(time.monotonic() - self._refresh_started_at)
            if self._refresh_started_at is not None
            else 0
        )
        progress: dict[str, int] | None = None
        if self._phase_progress is not None:
            done, total = self._phase_progress
            progress = {"done": done, "total": total}
        return {
            "phase": self._refresh_phase,
            "elapsed_seconds": elapsed,
            "progress": progress,
        }

    # ----- freshness / counts -----

    async def data_age_seconds(self) -> int | None:
        """Returns the age (in seconds) of the most recently updated movie row,
        or None if the table is empty."""
        async with SessionLocal() as db:
            ts = (
                await db.execute(select(func.max(CatalogMovie.updated_at)))
            ).scalar_one_or_none()
        if ts is None:
            return None
        return int(time.time() - ts.timestamp())

    async def is_fresh(self) -> bool:
        age = await self.data_age_seconds()
        return age is not None and age < self._ttl

    async def count_movies(self) -> int:
        async with SessionLocal() as db:
            return int(
                (
                    await db.execute(select(func.count()).select_from(CatalogMovie))
                ).scalar_one()
                or 0
            )

    # ----- point lookups -----

    async def get_movie(self, rating_key: str) -> Movie | None:
        async with SessionLocal() as db:
            row = (
                await db.execute(
                    select(CatalogMovie).where(CatalogMovie.plex_rating_key == rating_key)
                )
            ).scalar_one_or_none()
        return _row_to_movie(row) if row else None

    async def get_movies_by_keys(self, keys: list[str]) -> dict[str, Movie]:
        if not keys:
            return {}
        async with SessionLocal() as db:
            rows = (
                await db.execute(
                    select(CatalogMovie).where(CatalogMovie.plex_rating_key.in_(keys))
                )
            ).scalars().all()
        return {r.plex_rating_key: _row_to_movie(r) for r in rows}

    async def get_collections(self) -> list[Collection]:
        async with SessionLocal() as db:
            rows = (await db.execute(select(CatalogCollection))).scalars().all()
        return [
            Collection(
                name=r.name,
                size=r.size or 0,
                rating_keys=tuple(r.rating_keys or []),
            )
            for r in rows
        ]

    # ----- search -----

    async def search(
        self,
        *,
        genres: list[str] | None = None,
        year_min: int | None = None,
        year_max: int | None = None,
        cast: str | None = None,
        director: str | None = None,
        max_runtime: int | None = None,
        min_audience_rating: float | None = None,
        watched_status: str = "any",
        in_collection: str | None = None,
        added_after: datetime | None = None,
        sort: str = "popularity",
    ) -> list[Movie]:
        """Filter + sort `catalog_movie` rows. Returns ALL matches, unlimited —
        the caller slices to its limit. This lets the structured-filter set
        feed into vector ranking when a `query` is also provided.
        """
        stmt = select(CatalogMovie)
        if genres:
            # JSONB array containment, case-insensitive: cast to text and
            # ILIKE-match each genre as a quoted JSON string. For 1-3 genres
            # this is faster than a normalize-then-compare and avoids needing
            # a GIN index just for case folding.
            clauses = [
                sa.cast(CatalogMovie.genres, sa.Text).ilike(f'%"{g}"%')
                for g in genres
            ]
            stmt = stmt.where(sa.or_(*clauses))
        if year_min is not None:
            stmt = stmt.where(CatalogMovie.year >= year_min)
        if year_max is not None:
            stmt = stmt.where(CatalogMovie.year <= year_max)
        if max_runtime is not None:
            stmt = stmt.where(CatalogMovie.duration_min <= max_runtime)
        if min_audience_rating is not None:
            stmt = stmt.where(CatalogMovie.audience_rating >= min_audience_rating)
        if watched_status == "watched":
            stmt = stmt.where(CatalogMovie.view_count > 0)
        elif watched_status == "unwatched":
            stmt = stmt.where(CatalogMovie.view_count == 0)
        if cast:
            stmt = stmt.where(
                sa.cast(CatalogMovie.top_cast, sa.Text).ilike(f"%{cast}%")
            )
        if director:
            stmt = stmt.where(
                sa.cast(CatalogMovie.directors, sa.Text).ilike(f"%{director}%")
            )
        if in_collection:
            stmt = stmt.where(
                sa.cast(CatalogMovie.collections_list, sa.Text).ilike(
                    f'%"{in_collection}"%'
                )
            )
        if added_after is not None:
            stmt = stmt.where(CatalogMovie.added_at >= added_after)

        if sort == "rating":
            stmt = stmt.order_by(CatalogMovie.audience_rating.desc().nulls_last())
        elif sort == "recent_added":
            stmt = stmt.order_by(CatalogMovie.added_at.desc().nulls_last())
        else:  # popularity ~ view_count
            stmt = stmt.order_by(CatalogMovie.view_count.desc())

        async with SessionLocal() as db:
            rows = (await db.execute(stmt)).scalars().all()
        return [_row_to_movie(r) for r in rows]

    async def user_history(self, *, sort: str = "recent", limit: int = 20) -> list[Movie]:
        stmt = select(CatalogMovie).where(CatalogMovie.view_count > 0)
        if sort == "most_watched":
            stmt = stmt.order_by(CatalogMovie.view_count.desc())
        else:  # recent
            stmt = stmt.order_by(CatalogMovie.last_viewed_at.desc().nulls_last())
        stmt = stmt.limit(limit)
        async with SessionLocal() as db:
            rows = (await db.execute(stmt)).scalars().all()
        return [_row_to_movie(r) for r in rows]

    # ----- refresh -----

    async def refresh_from_plex(self, force: bool = False) -> int:
        """Pull the catalog from Plex, upsert into Postgres, prune disappeared
        rows. Returns the post-refresh movie count. With `force=False`, no-ops
        if persisted data is fresher than `CATALOG_TTL_SECONDS`.
        """
        if not force and await self.is_fresh():
            count = await self.count_movies()
            age = await self.data_age_seconds()
            log.info(
                "catalog.refresh.skip",
                reason="fresh",
                age_seconds=age,
                ttl_seconds=self._ttl,
                movie_count=count,
            )
            return count

        waited = self._refresh_lock.locked()
        if waited:
            log.info("catalog.refresh.waiting_for_lock")
        async with self._refresh_lock:
            if waited:
                log.info("catalog.refresh.lock_acquired")
                # Another caller may have just refreshed.
                if not force and await self.is_fresh():
                    count = await self.count_movies()
                    log.info(
                        "catalog.refresh.skip",
                        reason="fresh_after_lock",
                        movie_count=count,
                    )
                    return count

            t0 = time.monotonic()
            self._refresh_started_at = t0
            log.info("catalog.refresh.start", force=force, ttl_seconds=self._ttl)

            try:
                self._refresh_phase = "fetching_movies"
                self._phase_progress = None
                log.info("catalog.refresh.movies.fetching")

                def _on_movies_progress(done: int, total: int) -> None:
                    self._phase_progress = (done, total)

                movies = await self._plex.fetch_movies(_on_movies_progress)
                t_movies = time.monotonic()
                log.info(
                    "catalog.refresh.movies.fetched",
                    count=len(movies),
                    elapsed_ms=int((t_movies - t0) * 1000),
                )

                self._refresh_phase = "fetching_collections"
                self._phase_progress = None
                log.info("catalog.refresh.collections.fetching")

                def _on_collections_progress(done: int, total: int) -> None:
                    self._phase_progress = (done, total)

                collections = await self._plex.fetch_collections(_on_collections_progress)
                t_collections = time.monotonic()
                log.info(
                    "catalog.refresh.collections.fetched",
                    count=len(collections),
                    elapsed_ms=int((t_collections - t_movies) * 1000),
                )

                self._refresh_phase = "persisting"
                self._phase_progress = (0, len(movies)) if movies else None
                t_persist = time.monotonic()
                await self._persist(movies, collections)
                log.info(
                    "catalog.refresh.persisted",
                    elapsed_ms=int((time.monotonic() - t_persist) * 1000),
                )
                log.info(
                    "catalog.refresh.done",
                    movie_count=len(movies),
                    collection_count=len(collections),
                    movies_ms=int((t_movies - t0) * 1000),
                    collections_ms=int((t_collections - t_movies) * 1000),
                    persist_ms=int((time.monotonic() - t_persist) * 1000),
                    total_ms=int((time.monotonic() - t0) * 1000),
                )
                return len(movies)
            finally:
                self._refresh_phase = None
                self._refresh_started_at = None
                self._phase_progress = None

    async def _persist(self, movies: list[Movie], collections: list[Collection]) -> None:
        """Upsert movies and collections, then prune rows we didn't see."""
        now = datetime.now(UTC)
        total = len(movies)
        async with SessionLocal() as db:
            if movies:
                rows = [_movie_to_row(m, now) for m in movies]
                CHUNK = 500
                for i in range(0, len(rows), CHUNK):
                    chunk = rows[i : i + CHUNK]
                    self._phase_progress = (i, total)
                    stmt = pg_insert(CatalogMovie).values(chunk)
                    stmt = stmt.on_conflict_do_update(
                        index_elements=["plex_rating_key"],
                        set_={
                            "title": stmt.excluded.title,
                            "year": stmt.excluded.year,
                            "genres": stmt.excluded.genres,
                            "summary": stmt.excluded.summary,
                            "audience_rating": stmt.excluded.audience_rating,
                            "content_rating": stmt.excluded.content_rating,
                            "duration_min": stmt.excluded.duration_min,
                            "directors": stmt.excluded.directors,
                            "top_cast": stmt.excluded.top_cast,
                            "view_count": stmt.excluded.view_count,
                            "last_viewed_at": stmt.excluded.last_viewed_at,
                            "added_at": stmt.excluded.added_at,
                            "collections_list": stmt.excluded.collections_list,
                            "thumb": stmt.excluded.thumb,
                            "last_seen_at": stmt.excluded.last_seen_at,
                            "updated_at": stmt.excluded.updated_at,
                        },
                    )
                    await db.execute(stmt)
                self._phase_progress = (total, total)

            # Prune rows that disappeared from Plex (last_seen_at older than this run).
            pruned = await db.execute(
                delete(CatalogMovie).where(CatalogMovie.last_seen_at < now)
            )
            pruned_count = getattr(pruned, "rowcount", 0) or 0
            if pruned_count:
                log.info("catalog.persist.movies_pruned", count=pruned_count)

            # Replace collections wholesale.
            await db.execute(delete(CatalogCollection))
            if collections:
                col_rows = [
                    {
                        "name": c.name,
                        "size": c.size,
                        "rating_keys": list(c.rating_keys),
                        "last_seen_at": now,
                    }
                    for c in collections
                ]
                await db.execute(pg_insert(CatalogCollection).values(col_rows))

            await db.commit()


@lru_cache
def get_catalog_service() -> CatalogService:
    settings = get_settings()
    return CatalogService(get_plex_client(), settings.catalog_ttl_seconds)
