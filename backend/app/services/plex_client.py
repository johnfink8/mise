"""Wrapper around python-plexapi.

python-plexapi is sync; we run blocking calls in a thread executor so the FastAPI
event loop stays responsive.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from datetime import datetime
from functools import lru_cache
from typing import Any

import structlog

from app.config import get_settings

log = structlog.get_logger()

# Page size for the manual pagination of `section.all()`. Plex's default
# X-Plex-Container-Size is 100; 200 cuts the round-trip count in half on
# large libraries while staying small enough to update progress smoothly.
_MOVIE_PAGE_SIZE = 200

# Type alias for the optional progress callback. Implementations get
# (done, total) per page or per item processed.
ProgressCb = Callable[[int, int], None]


@dataclass(frozen=True)
class Movie:
    rating_key: str
    title: str
    year: int | None
    genres: tuple[str, ...]
    summary: str
    audience_rating: float | None
    content_rating: str | None
    duration_min: int | None
    directors: tuple[str, ...]
    top_cast: tuple[str, ...]
    view_count: int
    last_viewed_at: datetime | None
    added_at: datetime | None
    collections: tuple[str, ...]
    thumb: str | None  # Plex path like "/library/metadata/123/thumb/..."

    def to_compact_dict(self) -> dict[str, Any]:
        """Compact projection suitable for tool outputs."""
        return {
            "rating_key": self.rating_key,
            "title": self.title,
            "year": self.year,
            "genres": list(self.genres),
            "runtime_min": self.duration_min,
            "audience_rating": self.audience_rating,
            "view_count": self.view_count,
        }

    def to_full_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["genres"] = list(self.genres)
        d["directors"] = list(self.directors)
        d["top_cast"] = list(self.top_cast)
        d["collections"] = list(self.collections)
        d["last_viewed_at"] = self.last_viewed_at.isoformat() if self.last_viewed_at else None
        d["added_at"] = self.added_at.isoformat() if self.added_at else None
        return d


@dataclass
class Collection:
    name: str
    size: int
    rating_keys: tuple[str, ...] = field(default_factory=tuple)


def _ms_to_min(ms: int | None) -> int | None:
    if not ms:
        return None
    return int(round(ms / 60_000))


def _normalize_movie(item: Any) -> Movie:
    """Normalize a plexapi Movie object into our frozen dataclass."""
    return Movie(
        rating_key=str(item.ratingKey),
        title=str(item.title),
        year=int(item.year) if getattr(item, "year", None) else None,
        genres=tuple(g.tag for g in (getattr(item, "genres", None) or [])),
        summary=getattr(item, "summary", "") or "",
        audience_rating=(
            float(item.audienceRating) if getattr(item, "audienceRating", None) is not None
            else (float(item.rating) if getattr(item, "rating", None) is not None else None)
        ),
        content_rating=getattr(item, "contentRating", None),
        duration_min=_ms_to_min(getattr(item, "duration", None)),
        directors=tuple(d.tag for d in (getattr(item, "directors", None) or [])),
        top_cast=tuple(r.tag for r in (getattr(item, "roles", None) or [])[:10]),
        view_count=int(getattr(item, "viewCount", 0) or 0),
        last_viewed_at=getattr(item, "lastViewedAt", None),
        added_at=getattr(item, "addedAt", None),
        collections=tuple(c.tag for c in (getattr(item, "collections", None) or [])),
        thumb=getattr(item, "thumb", None),
    )


class PlexClient:
    def __init__(self, base_url: str, token: str) -> None:
        self._base_url = base_url
        self._token = token
        self._server: Any | None = None
        self._machine_identifier: str | None = None

    def _connect(self) -> Any:
        if self._server is None:
            from plexapi.server import PlexServer

            t0 = time.monotonic()
            log.info("plex.connect.start", base_url=self._base_url)
            self._server = PlexServer(self._base_url, self._token)  # type: ignore[no-untyped-call]
            self._machine_identifier = getattr(self._server, "machineIdentifier", None)
            log.info(
                "plex.connect.done",
                base_url=self._base_url,
                server_name=getattr(self._server, "friendlyName", None),
                version=getattr(self._server, "version", None),
                machine_identifier=self._machine_identifier,
                elapsed_ms=int((time.monotonic() - t0) * 1000),
            )
        return self._server

    def web_url(self, rating_key: str) -> str | None:
        """Build a Plex Web deep link to play a movie by rating_key.

        Returns None if we haven't connected to Plex yet (no machineIdentifier).
        Routing through `app.plex.tv` lets the user log in once there and have
        the link work from anywhere; LAN-local Plex web also accepts the same
        anchor-fragment routing.
        """
        if self._machine_identifier is None:
            return None
        return (
            f"https://app.plex.tv/desktop/#!/server/{self._machine_identifier}"
            f"/details?key=%2Flibrary%2Fmetadata%2F{rating_key}"
        )

    async def ensure_connected(self) -> None:
        """Trigger the lazy connect so `machineIdentifier` (and thus
        `web_url(...)`) is available without needing a full catalog refresh."""
        await asyncio.to_thread(self._connect)

    async def fetch_movies(
        self, progress_cb: ProgressCb | None = None
    ) -> list[Movie]:
        """Fetch every movie across all 'movie' library sections.

        Pages the request manually so callers can render a determinate
        progress bar instead of an indeterminate spinner during a long
        cold-start scan. `progress_cb(done, total)` is invoked after each
        page; `total` is the sum of `section.totalSize` across movie
        sections.
        """
        return await asyncio.to_thread(self._fetch_movies_sync, progress_cb)

    def _fetch_movies_sync(self, progress_cb: ProgressCb | None) -> list[Movie]:
        t0 = time.monotonic()
        server = self._connect()
        log.info("plex.fetch_movies.sections.start")
        sections = server.library.sections()
        movie_sections = [s for s in sections if getattr(s, "type", None) == "movie"]
        log.info(
            "plex.fetch_movies.sections.found",
            total_sections=len(sections),
            movie_sections=[getattr(s, "title", "?") for s in movie_sections],
        )

        # Pre-flight: get totalSize for each section so we can drive a
        # single global progress denominator across all sections.
        section_totals: list[tuple[Any, int]] = []
        grand_total = 0
        for section in movie_sections:
            try:
                size = int(getattr(section, "totalSize", 0) or 0)
            except Exception:
                size = 0
            section_totals.append((section, size))
            grand_total += size
        if progress_cb:
            progress_cb(0, max(grand_total, 1))

        movies: list[Movie] = []
        done = 0
        for section, total in section_totals:
            section_title = getattr(section, "title", "?")
            t_section = time.monotonic()
            log.info(
                "plex.fetch_movies.section.start",
                section=section_title,
                total=total,
            )
            # Manual pagination. Without `maxresults`, plexapi pages
            # internally but only returns once everything has been fetched —
            # which is what stalls the progress bar on large libraries.
            # Capping `maxresults=container_size` makes each call return a
            # single page so we can fire the progress callback between them.
            start = 0
            while True:
                page = section.all(
                    container_start=start,
                    container_size=_MOVIE_PAGE_SIZE,
                    maxresults=_MOVIE_PAGE_SIZE,
                )
                if not page:
                    break
                for item in page:
                    movies.append(_normalize_movie(item))
                done += len(page)
                start += len(page)
                if progress_cb:
                    progress_cb(done, max(grand_total, done))
                if len(page) < _MOVIE_PAGE_SIZE:
                    # Last page (partial) — we're done with this section.
                    break
            log.info(
                "plex.fetch_movies.section.done",
                section=section_title,
                fetched=start,
                expected=total,
                section_total_ms=int((time.monotonic() - t_section) * 1000),
            )
        if progress_cb:
            progress_cb(len(movies), max(grand_total, len(movies)))
        log.info(
            "plex.fetch_movies.done",
            count=len(movies),
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
        return movies

    async def fetch_collections(
        self, progress_cb: ProgressCb | None = None
    ) -> list[Collection]:
        return await asyncio.to_thread(self._fetch_collections_sync, progress_cb)

    def _fetch_collections_sync(
        self, progress_cb: ProgressCb | None
    ) -> list[Collection]:
        t0 = time.monotonic()
        server = self._connect()
        out: list[Collection] = []

        # Pre-flight: collect all collection objects across movie sections so
        # we have a known total for the progress denominator. The slow part
        # is `col.items()` per collection — fetching the rating-key list —
        # which is what we actually want to track.
        all_cols: list[Any] = []
        for section in server.library.sections():
            if getattr(section, "type", None) != "movie":
                continue
            t_section = time.monotonic()
            cols = section.collections()
            log.info(
                "plex.fetch_collections.section.listed",
                section=getattr(section, "title", "?"),
                collection_count=len(cols),
                elapsed_ms=int((time.monotonic() - t_section) * 1000),
            )
            all_cols.extend(cols)

        total = len(all_cols)
        if progress_cb:
            progress_cb(0, max(total, 1))

        for idx, col in enumerate(all_cols, start=1):
            children = col.items() if hasattr(col, "items") else []
            rating_keys = tuple(str(c.ratingKey) for c in children)
            out.append(
                Collection(name=str(col.title), size=len(rating_keys), rating_keys=rating_keys)
            )
            if progress_cb:
                progress_cb(idx, total)

        log.info(
            "plex.fetch_collections.done",
            count=len(out),
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
        return out

    async def fetch_thumb_bytes(self, rating_key: str) -> tuple[bytes, str]:
        """Fetch thumbnail bytes for a given movie's rating key.

        Returns (bytes, content_type).
        """
        return await asyncio.to_thread(self._fetch_thumb_sync, rating_key)

    def _fetch_thumb_sync(self, rating_key: str) -> tuple[bytes, str]:
        t0 = time.monotonic()
        server = self._connect()
        item = server.fetchItem(int(rating_key))
        thumb_url: str | None = getattr(item, "thumbUrl", None)
        if not thumb_url:
            log.warning("plex.fetch_thumb.missing", rating_key=rating_key)
            raise FileNotFoundError(f"no thumb for rating_key={rating_key}")
        # Use plexapi's session for auth; thumbUrl already has token if needed
        session = getattr(server, "_session", None)
        if session is None:
            import requests

            session = requests.Session()
        resp = session.get(thumb_url, timeout=10)
        resp.raise_for_status()
        log.debug(
            "plex.fetch_thumb.done",
            rating_key=rating_key,
            bytes=len(resp.content),
            elapsed_ms=int((time.monotonic() - t0) * 1000),
        )
        return resp.content, resp.headers.get("content-type", "image/jpeg")


@lru_cache
def get_plex_client() -> PlexClient:
    settings = get_settings()
    return PlexClient(settings.plex_base_url, settings.plex_token)
