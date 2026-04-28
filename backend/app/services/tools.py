"""Tool registry for the agentic loop.

Each tool exposes a JSON schema for Claude and an async `execute` that operates
against the in-memory catalog and the embedding service.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from app.services.catalog_service import CatalogService
from app.services.embeddings import EmbeddingService


@dataclass
class ToolContext:
    catalog: CatalogService
    embeddings: EmbeddingService


@dataclass
class Tool:
    name: str
    description: str
    input_schema: dict[str, Any]
    execute: Callable[[dict[str, Any], ToolContext], Awaitable[dict[str, Any]]]
    is_terminal: bool = False


# ----- helpers -----


def _parse_iso_date(s: str) -> datetime | None:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


# ----- tool implementations -----


async def _search_movies(input: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    """Filter the catalog by structured criteria via Postgres, then rank.

    If `query` is provided, the structurally-filtered candidates are ranked by
    cosine similarity between the query string's embedding and each movie's
    description embedding (no literal substring matching). Otherwise, results
    fall through ordered by `sort` (popularity / rating / recent_added).
    """
    query: str | None = input.get("query")
    sort: str = input.get("sort") or "popularity"
    limit: int = max(1, min(int(input.get("limit") or 100), 250))
    added_after_str: str | None = input.get("added_after")

    added_after = _parse_iso_date(added_after_str) if added_after_str else None
    if added_after and added_after.tzinfo is None:
        added_after = added_after.replace(tzinfo=UTC)

    candidates = await ctx.catalog.search(
        genres=input.get("genres"),
        year_min=input.get("year_min"),
        year_max=input.get("year_max"),
        cast=input.get("cast"),
        director=input.get("director"),
        max_runtime=input.get("max_runtime"),
        min_audience_rating=input.get("min_audience_rating"),
        watched_status=input.get("watched_status") or "any",
        in_collection=input.get("in_collection"),
        added_after=added_after,
        sort=sort,
    )
    total_matches = len(candidates)

    if query and query.strip():
        ranked = await ctx.embeddings.rank_by_query(
            query.strip(),
            [m.rating_key for m in candidates],
            limit,
        )
        by_key = {m.rating_key: m for m in candidates}
        results = []
        for r in ranked:
            m = by_key.get(r.rating_key)
            if m is None:
                continue
            d = m.to_compact_dict()
            d["similarity"] = round(r.similarity, 4)
            results.append(d)
        return {
            "count": len(results),
            "total_matches": total_matches,
            "ranked_by": "query_similarity",
            "results": results,
        }

    results = [m.to_compact_dict() for m in candidates[:limit]]
    return {
        "count": len(results),
        "total_matches": total_matches,
        "ranked_by": sort,
        "results": results,
    }


async def _get_movie_details(input: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    rating_key = str(input.get("rating_key", "")).strip()
    movie = await ctx.catalog.get_movie(rating_key)
    if not movie:
        return {"error": f"unknown rating_key: {rating_key}"}
    return {"movie": movie.to_full_dict()}


async def _get_user_history(input: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    limit: int = max(1, min(int(input.get("limit") or 20), 100))
    sort: str = input.get("sort") or "recent"
    movies = await ctx.catalog.user_history(sort=sort, limit=limit)
    items = [
        {
            "rating_key": m.rating_key,
            "title": m.title,
            "year": m.year,
            "view_count": m.view_count,
            "last_viewed_at": m.last_viewed_at.isoformat() if m.last_viewed_at else None,
        }
        for m in movies
    ]
    return {"count": len(items), "results": items}


async def _get_similar_to(input: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    rating_key = str(input.get("rating_key", "")).strip()
    k = max(1, min(int(input.get("k") or 10), 25))
    seed = await ctx.catalog.get_movie(rating_key)
    if not seed:
        return {"error": f"unknown rating_key: {rating_key}"}
    similar = await ctx.embeddings.similar_to(rating_key, k)
    # Batch-resolve metadata in one DB round-trip rather than N.
    by_key = await ctx.catalog.get_movies_by_keys([s.rating_key for s in similar])
    items: list[dict[str, Any]] = []
    for s in similar:
        m = by_key.get(s.rating_key)
        if not m:
            continue
        items.append(
            {
                "rating_key": m.rating_key,
                "title": m.title,
                "year": m.year,
                "similarity": round(s.similarity, 4),
                "genres": list(m.genres),
            }
        )
    return {"seed": {"rating_key": seed.rating_key, "title": seed.title}, "results": items}


async def _list_collections(_input: dict[str, Any], ctx: ToolContext) -> dict[str, Any]:
    cols = await ctx.catalog.get_collections()
    return {
        "count": len(cols),
        "collections": [{"name": c.name, "size": c.size} for c in cols],
    }


async def _submit_recommendations(input: dict[str, Any], _ctx: ToolContext) -> dict[str, Any]:
    # The agentic loop intercepts this terminal tool before execute is called.
    # If we get here, just echo the payload back.
    return {"submitted": input}


# ----- registry -----


def build_registry() -> dict[str, Tool]:
    return {
        "search_movies": Tool(
            name="search_movies",
            description=(
                "Search the user's local Plex movie library. Combine any of the optional "
                "filters; all are AND-ed together. Use this to discover candidates that match "
                "the user's request before recommending."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": (
                            "Natural-language description of the vibe/mood/themes you want "
                            "(e.g. 'slow-burn neo-noir with a melancholy detective'). "
                            "Results are ranked by semantic similarity to this query — it is "
                            "NOT a literal title/summary substring match. Combine with "
                            "structured filters (genres, year_min, etc.) to narrow the "
                            "candidate pool before ranking. When `query` is set, `sort` is "
                            "ignored."
                        ),
                    },
                    "genres": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Movies must have at least one of these genres.",
                    },
                    "year_min": {"type": "integer"},
                    "year_max": {"type": "integer"},
                    "cast": {
                        "type": "string",
                        "description": "Substring match against any of the top 10 cast members.",
                    },
                    "director": {"type": "string"},
                    "max_runtime": {
                        "type": "integer",
                        "description": "Maximum runtime in minutes.",
                    },
                    "min_audience_rating": {
                        "type": "number",
                        "description": "Plex audience rating, 0-10.",
                    },
                    "watched_status": {
                        "type": "string",
                        "enum": ["watched", "unwatched", "any"],
                        "default": "any",
                    },
                    "in_collection": {
                        "type": "string",
                        "description": "Collection name (must match exactly; use list_collections first).",
                    },
                    "added_after": {
                        "type": "string",
                        "description": "ISO 8601 date; only movies added on/after this date.",
                    },
                    "sort": {
                        "type": "string",
                        "enum": ["recent_added", "popularity", "rating"],
                        "default": "popularity",
                    },
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 250,
                        "default": 100,
                        "description": (
                            "Max results to return. If total_matches >> count, "
                            "add filters or increase limit rather than re-querying broadly."
                        ),
                    },
                },
                "additionalProperties": False,
            },
            execute=_search_movies,
        ),
        "get_movie_details": Tool(
            name="get_movie_details",
            description=(
                "Get full metadata for a single movie by rating_key. Use this to drill into "
                "a candidate before recommending it."
            ),
            input_schema={
                "type": "object",
                "properties": {"rating_key": {"type": "string"}},
                "required": ["rating_key"],
                "additionalProperties": False,
            },
            execute=_get_movie_details,
        ),
        "get_user_history": Tool(
            name="get_user_history",
            description=(
                "Return movies the user has watched, sorted by recency or watch count. "
                "Use this as a taste signal."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20},
                    "sort": {
                        "type": "string",
                        "enum": ["recent", "most_watched"],
                        "default": "recent",
                    },
                },
                "additionalProperties": False,
            },
            execute=_get_user_history,
        ),
        "get_similar_to": Tool(
            name="get_similar_to",
            description=(
                "Return the k most semantically similar movies (by description embedding) "
                "to a given seed movie. Use this when the user references a movie or genre "
                "and you want neighbours from the library."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "rating_key": {"type": "string"},
                    "k": {"type": "integer", "minimum": 1, "maximum": 25, "default": 10},
                },
                "required": ["rating_key"],
                "additionalProperties": False,
            },
            execute=_get_similar_to,
        ),
        "list_collections": Tool(
            name="list_collections",
            description=(
                "List the user's curated Plex collections (e.g. 'Christmas movies'). "
                "Useful when the user asks for something themed."
            ),
            input_schema={
                "type": "object",
                "properties": {},
                "additionalProperties": False,
            },
            execute=_list_collections,
        ),
        "submit_recommendations": Tool(
            name="submit_recommendations",
            description=(
                "TERMINAL: emit the final recommendations to return to the user. "
                "Each rating_key MUST come from a previous tool result. Provide a one or "
                "two sentence reasoning for each pick that ties back to the user's request."
            ),
            input_schema={
                "type": "object",
                "properties": {
                    "follow_up_suggestion": {
                        "type": "string",
                        "description": (
                            "OPTIONAL one-line suggested next refinement, written in "
                            "the user's voice as a chat message they might type next "
                            "(lowercase, casual, no period, ≤60 chars). The frontend "
                            "uses this as the chat input placeholder so the user can "
                            "see a plausible next thing to ask. Examples: 'shorter, "
                            "under 90 minutes', 'something with a bigger laugh', "
                            "'less Bill Murray, more Tina Fey', 'one more like the "
                            "first pick', 'darker tone'. Tailor it to the picks you "
                            "just made — what would naturally narrow or pivot from here?"
                        ),
                    },
                    "recommendations": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 25,
                        "items": {
                            "type": "object",
                            "properties": {
                                "rating_key": {"type": "string"},
                                "reasoning": {"type": "string"},
                                "group": {
                                    "type": "string",
                                    "description": (
                                        "OPTIONAL thematic group label for this pick "
                                        "(e.g. 'Cerebral sci-fi', 'Comfort romcoms', "
                                        "'Hidden gems'). If the user's request is broad "
                                        "enough that 2-4 distinct angles each deserve a "
                                        "few picks, attach a short noun-phrase label "
                                        "shared by 3-6 items. For focused requests, omit "
                                        "this field — a flat list reads better. Within a "
                                        "single submission, group labels MUST be reused "
                                        "exactly so picks land in the same bucket."
                                    ),
                                },
                            },
                            "required": ["rating_key", "reasoning"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["recommendations"],
                "additionalProperties": False,
            },
            execute=_submit_recommendations,
            is_terminal=True,
        ),
    }


REGISTRY = build_registry()
