"""Unit tests for tool implementations."""

from __future__ import annotations

import pytest

from app.services.tools import REGISTRY, ToolContext


@pytest.fixture
def ctx(fake_catalog, fake_embeddings) -> ToolContext:
    return ToolContext(catalog=fake_catalog, embeddings=fake_embeddings)


async def test_search_movies_genre_filter(ctx: ToolContext) -> None:
    result = await REGISTRY["search_movies"].execute({"genres": ["comedy"]}, ctx)
    titles = {r["title"] for r in result["results"]}
    assert "Groundhog Day" in titles
    assert "When Harry Met Sally" in titles
    assert "The Matrix" not in titles


async def test_search_movies_year_range(ctx: ToolContext) -> None:
    result = await REGISTRY["search_movies"].execute(
        {"year_min": 1990, "year_max": 1999}, ctx
    )
    assert all(r["year"] is not None and 1990 <= r["year"] <= 1999 for r in result["results"])


async def test_search_movies_unwatched(ctx: ToolContext) -> None:
    result = await REGISTRY["search_movies"].execute({"watched_status": "unwatched"}, ctx)
    titles = {r["title"] for r in result["results"]}
    assert titles == {"Groundhog Day", "When Harry Met Sally"}


async def test_search_movies_query_match(ctx: ToolContext) -> None:
    result = await REGISTRY["search_movies"].execute({"query": "hacker"}, ctx)
    assert any(r["title"] == "The Matrix" for r in result["results"])
    assert result["ranked_by"] == "query_similarity"
    assert all("similarity" in r for r in result["results"])


async def test_search_movies_query_with_filters(ctx: ToolContext) -> None:
    """Structured filters narrow the candidate pool BEFORE vector ranking."""
    result = await REGISTRY["search_movies"].execute(
        {"query": "hacker matrix", "genres": ["comedy"]},
        ctx,
    )
    # Genre filter excludes The Matrix entirely; query ranking can't bring it back.
    assert all(r["title"] != "The Matrix" for r in result["results"])
    assert result["ranked_by"] == "query_similarity"


async def test_search_movies_no_query_uses_sort(ctx: ToolContext) -> None:
    """Without a query, results fall back to the requested `sort` order."""
    result = await REGISTRY["search_movies"].execute({"sort": "rating"}, ctx)
    assert result["ranked_by"] == "rating"
    assert "similarity" not in result["results"][0]


async def test_search_movies_max_runtime(ctx: ToolContext) -> None:
    result = await REGISTRY["search_movies"].execute({"max_runtime": 100}, ctx)
    assert all((r["runtime_min"] or 0) <= 100 for r in result["results"])


async def test_search_movies_director_filter(ctx: ToolContext) -> None:
    result = await REGISTRY["search_movies"].execute({"director": "Mann"}, ctx)
    titles = {r["title"] for r in result["results"]}
    assert titles == {"Heat"}


async def test_get_movie_details_known(ctx: ToolContext) -> None:
    result = await REGISTRY["get_movie_details"].execute({"rating_key": "1"}, ctx)
    assert result["movie"]["title"] == "The Matrix"
    assert "Keanu Reeves" in result["movie"]["top_cast"]


async def test_get_movie_details_unknown(ctx: ToolContext) -> None:
    result = await REGISTRY["get_movie_details"].execute({"rating_key": "999"}, ctx)
    assert "error" in result


async def test_get_user_history_recent(ctx: ToolContext) -> None:
    result = await REGISTRY["get_user_history"].execute({"sort": "recent"}, ctx)
    titles = [r["title"] for r in result["results"]]
    # Matrix viewed Jan 2025, Heat viewed Nov 2024
    assert titles == ["The Matrix", "Heat"]


async def test_get_user_history_most_watched(ctx: ToolContext) -> None:
    result = await REGISTRY["get_user_history"].execute({"sort": "most_watched"}, ctx)
    titles = [r["title"] for r in result["results"]]
    assert titles[0] == "The Matrix"  # view_count=2 vs 1


async def test_get_similar_to(ctx: ToolContext) -> None:
    result = await REGISTRY["get_similar_to"].execute({"rating_key": "1", "k": 5}, ctx)
    assert result["seed"]["rating_key"] == "1"
    assert result["results"][0]["rating_key"] == "3"


async def test_get_similar_to_unknown(ctx: ToolContext) -> None:
    result = await REGISTRY["get_similar_to"].execute({"rating_key": "999"}, ctx)
    assert "error" in result


async def test_list_collections(ctx: ToolContext) -> None:
    result = await REGISTRY["list_collections"].execute({}, ctx)
    assert result["count"] == 1
    assert result["collections"][0]["name"] == "Sci-Fi Classics"


async def test_search_movies_in_collection(ctx: ToolContext) -> None:
    result = await REGISTRY["search_movies"].execute({"in_collection": "Sci-Fi Classics"}, ctx)
    titles = {r["title"] for r in result["results"]}
    assert titles == {"The Matrix"}


async def test_search_movies_added_after(ctx: ToolContext) -> None:
    result = await REGISTRY["search_movies"].execute({"added_after": "2025-01-01"}, ctx)
    titles = {r["title"] for r in result["results"]}
    assert titles == {"When Harry Met Sally"}


async def test_search_movies_limit_capped(ctx: ToolContext) -> None:
    result = await REGISTRY["search_movies"].execute({"limit": 200}, ctx)
    # Total of 4 movies; limit cap shouldn't break anything
    assert result["count"] <= 100
