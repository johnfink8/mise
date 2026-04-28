"""Shared pytest fixtures.

Tests mock all external services (Plex, Anthropic, Voyage). DB-backed tests use
the DATABASE_URL provided by CI (or local docker compose).
"""

from __future__ import annotations

import os
from datetime import UTC, datetime

# Make sure required env vars exist before app modules import settings.
os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+psycopg://mise:mise@localhost:5432/mise_test",
)
os.environ.setdefault("PLEX_BASE_URL", "http://plex.test:32400")
os.environ.setdefault("PLEX_TOKEN", "test-token")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-key")
os.environ.setdefault("VOYAGE_API_KEY", "test-key")

import pytest

from app.services.plex_client import Collection, Movie


@pytest.fixture
def sample_movies() -> list[Movie]:
    return [
        Movie(
            rating_key="1",
            title="The Matrix",
            year=1999,
            genres=("action", "sci-fi"),
            summary="A hacker discovers the world is a simulation.",
            audience_rating=8.7,
            content_rating="R",
            duration_min=136,
            directors=("Lana Wachowski", "Lilly Wachowski"),
            top_cast=("Keanu Reeves", "Laurence Fishburne", "Carrie-Anne Moss"),
            view_count=2,
            last_viewed_at=datetime(2025, 1, 5, tzinfo=UTC),
            added_at=datetime(2024, 1, 1, tzinfo=UTC),
            collections=("Sci-Fi Classics",),
            thumb="/library/metadata/1/thumb/123",
        ),
        Movie(
            rating_key="2",
            title="Groundhog Day",
            year=1993,
            genres=("comedy", "romance"),
            summary="A weatherman is stuck reliving the same day.",
            audience_rating=8.0,
            content_rating="PG",
            duration_min=101,
            directors=("Harold Ramis",),
            top_cast=("Bill Murray", "Andie MacDowell"),
            view_count=0,
            last_viewed_at=None,
            added_at=datetime(2024, 6, 1, tzinfo=UTC),
            collections=(),
            thumb="/library/metadata/2/thumb/456",
        ),
        Movie(
            rating_key="3",
            title="Heat",
            year=1995,
            genres=("crime", "thriller"),
            summary="A cop chases a master thief in LA.",
            audience_rating=8.3,
            content_rating="R",
            duration_min=170,
            directors=("Michael Mann",),
            top_cast=("Al Pacino", "Robert De Niro"),
            view_count=1,
            last_viewed_at=datetime(2024, 11, 1, tzinfo=UTC),
            added_at=datetime(2023, 12, 1, tzinfo=UTC),
            collections=(),
            thumb="/library/metadata/3/thumb/789",
        ),
        Movie(
            rating_key="4",
            title="When Harry Met Sally",
            year=1989,
            genres=("comedy", "romance"),
            summary="Two friends in NYC discuss whether men and women can be friends.",
            audience_rating=7.6,
            content_rating="R",
            duration_min=96,
            directors=("Rob Reiner",),
            top_cast=("Billy Crystal", "Meg Ryan"),
            view_count=0,
            last_viewed_at=None,
            added_at=datetime(2025, 3, 1, tzinfo=UTC),
            collections=(),
            thumb="/library/metadata/4/thumb/abc",
        ),
    ]


@pytest.fixture
def sample_collections() -> list[Collection]:
    return [
        Collection(name="Sci-Fi Classics", size=1, rating_keys=("1",)),
    ]


class FakeCatalogService:
    """In-memory stand-in for `CatalogService` — async surface, deterministic
    filter/sort logic that mirrors the SQL behavior."""

    def __init__(self, movies: list[Movie], collections: list[Collection]) -> None:
        self._by_key = {m.rating_key: m for m in movies}
        self._collections = collections

    async def data_age_seconds(self) -> int | None:
        return 0

    async def is_fresh(self) -> bool:
        return True

    async def count_movies(self) -> int:
        return len(self._by_key)

    async def get_movie(self, rating_key: str):
        return self._by_key.get(rating_key)

    async def get_movies_by_keys(self, keys: list[str]):
        return {k: self._by_key[k] for k in keys if k in self._by_key}

    async def get_collections(self):
        return list(self._collections)

    async def refresh_from_plex(self, force: bool = False) -> int:  # noqa: ARG002
        return len(self._by_key)

    async def search(
        self,
        *,
        genres=None,
        year_min=None,
        year_max=None,
        cast=None,
        director=None,
        max_runtime=None,
        min_audience_rating=None,
        watched_status: str = "any",
        in_collection=None,
        added_after=None,
        sort: str = "popularity",
    ):
        from datetime import UTC, datetime

        movies = list(self._by_key.values())

        def keep(m: Movie) -> bool:
            if genres:
                wanted = {g.lower() for g in genres}
                if not wanted.intersection({g.lower() for g in m.genres}):
                    return False
            if year_min is not None and (m.year is None or m.year < year_min):
                return False
            if year_max is not None and (m.year is None or m.year > year_max):
                return False
            if cast and not any(cast.lower() in c.lower() for c in m.top_cast):
                return False
            if director and not any(director.lower() in d.lower() for d in m.directors):
                return False
            if max_runtime is not None and (m.duration_min or 0) > max_runtime:
                return False
            if (
                min_audience_rating is not None
                and (m.audience_rating is None or m.audience_rating < min_audience_rating)
            ):
                return False
            if watched_status == "watched" and m.view_count <= 0:
                return False
            if watched_status == "unwatched" and m.view_count > 0:
                return False
            if in_collection and not any(
                in_collection.lower() == c.lower() for c in m.collections
            ):
                return False
            if added_after and m.added_at:
                ma = m.added_at if m.added_at.tzinfo else m.added_at.replace(tzinfo=UTC)
                if ma < added_after:
                    return False
            return True

        filtered = [m for m in movies if keep(m)]
        if sort == "rating":
            filtered.sort(key=lambda m: m.audience_rating or -1, reverse=True)
        elif sort == "recent_added":
            filtered.sort(
                key=lambda m: m.added_at or datetime.min.replace(tzinfo=UTC),
                reverse=True,
            )
        else:
            filtered.sort(key=lambda m: m.view_count, reverse=True)
        return filtered

    async def user_history(self, *, sort: str = "recent", limit: int = 20):
        from datetime import UTC, datetime

        movies = [m for m in self._by_key.values() if m.view_count > 0]
        if sort == "most_watched":
            movies.sort(key=lambda m: m.view_count, reverse=True)
        else:
            movies.sort(
                key=lambda m: m.last_viewed_at or datetime.min.replace(tzinfo=UTC),
                reverse=True,
            )
        return movies[:limit]


@pytest.fixture
def fake_catalog(
    sample_movies: list[Movie], sample_collections: list[Collection]
) -> FakeCatalogService:
    return FakeCatalogService(sample_movies, sample_collections)


class FakeEmbeddingService:
    def __init__(self) -> None:
        self.synced_movies: list[Movie] = []

    async def schedule_sync(self, movies):
        self.synced_movies = list(movies)

    async def similar_to(self, rating_key: str, k: int = 10):
        from app.services.embeddings import SimilarMovie

        # Return any other movies as "similar" with a synthetic similarity.
        if rating_key == "1":
            return [SimilarMovie(rating_key="3", similarity=0.82)]
        return []

    async def rank_by_query(
        self, query: str, candidate_keys: list[str], limit: int
    ):
        from app.services.embeddings import SimilarMovie

        # Deterministic stand-in: rank candidates whose title/summary contains
        # any whitespace-split token of the query first, then everything else,
        # so tests can assert that query-driven ranking happens.
        terms = [t.lower() for t in query.split() if t]
        movies = self.synced_movies or []
        by_key = {m.rating_key: m for m in movies}

        def score(rk: str) -> int:
            m = by_key.get(rk)
            if m is None:
                return 0
            haystack = f"{m.title} {m.summary}".lower()
            return sum(1 for t in terms if t in haystack)

        ranked = sorted(candidate_keys, key=score, reverse=True)[:limit]
        return [
            SimilarMovie(rating_key=k, similarity=0.9 - 0.01 * i)
            for i, k in enumerate(ranked)
        ]

    async def coverage(self) -> tuple[int, int]:
        return 0, 0


@pytest.fixture
def fake_embeddings(sample_movies: list[Movie]) -> FakeEmbeddingService:
    svc = FakeEmbeddingService()
    # Pre-seed so `rank_by_query` can resolve rating_keys to titles/summaries.
    svc.synced_movies = list(sample_movies)
    return svc
