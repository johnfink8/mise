"""Tests for the Plex client's normalization layer."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace

from app.services.plex_client import _normalize_movie


def _tag(t: str) -> SimpleNamespace:
    return SimpleNamespace(tag=t)


def test_normalize_movie_full() -> None:
    item = SimpleNamespace(
        ratingKey=42,
        title="Inception",
        year=2010,
        genres=[_tag("sci-fi"), _tag("action")],
        summary="Dreams within dreams.",
        audienceRating=8.8,
        rating=8.8,
        contentRating="PG-13",
        duration=148 * 60_000,
        directors=[_tag("Christopher Nolan")],
        roles=[_tag("Leonardo DiCaprio"), _tag("Joseph Gordon-Levitt")] + [_tag(f"Extra{i}") for i in range(15)],
        viewCount=3,
        lastViewedAt=datetime(2025, 2, 1, tzinfo=UTC),
        addedAt=datetime(2024, 5, 1, tzinfo=UTC),
        collections=[_tag("Mind-Benders")],
        thumb="/library/metadata/42/thumb/x",
    )
    movie = _normalize_movie(item)
    assert movie.rating_key == "42"
    assert movie.title == "Inception"
    assert movie.year == 2010
    assert movie.genres == ("sci-fi", "action")
    assert movie.duration_min == 148
    assert movie.audience_rating == 8.8
    assert movie.directors == ("Christopher Nolan",)
    assert len(movie.top_cast) == 10  # capped at 10
    assert movie.collections == ("Mind-Benders",)


def test_normalize_movie_missing_optionals() -> None:
    item = SimpleNamespace(
        ratingKey=7,
        title="Mystery",
        year=None,
        genres=None,
        summary=None,
        audienceRating=None,
        rating=None,
        contentRating=None,
        duration=None,
        directors=None,
        roles=None,
        viewCount=None,
        lastViewedAt=None,
        addedAt=None,
        collections=None,
        thumb=None,
    )
    movie = _normalize_movie(item)
    assert movie.rating_key == "7"
    assert movie.year is None
    assert movie.genres == ()
    assert movie.summary == ""
    assert movie.duration_min is None
    assert movie.view_count == 0
    assert movie.audience_rating is None


def test_to_compact_dict() -> None:
    item = SimpleNamespace(
        ratingKey=1,
        title="X",
        year=2000,
        genres=[_tag("drama")],
        summary="...",
        audienceRating=7.5,
        rating=None,
        contentRating="PG",
        duration=120 * 60_000,
        directors=[],
        roles=[],
        viewCount=0,
        lastViewedAt=None,
        addedAt=None,
        collections=[],
        thumb=None,
    )
    movie = _normalize_movie(item)
    d = movie.to_compact_dict()
    assert d["rating_key"] == "1"
    assert d["genres"] == ["drama"]
    assert d["runtime_min"] == 120
    assert d["audience_rating"] == 7.5
