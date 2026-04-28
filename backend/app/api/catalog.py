from typing import Any

from fastapi import APIRouter

from app.services.catalog_service import get_catalog_service
from app.services.embeddings import get_embedding_service

router = APIRouter(tags=["catalog"])


def _loading_payload() -> dict[str, Any] | None:
    """Compose the live loading state from the catalog + embedding services.

    Returns a dict shaped like:
        {
          "phase": "fetching_movies" | "fetching_collections" | "persisting" | "embedding",
          "elapsed_seconds": int | None,
          "progress": {"done": int, "total": int} | None,
        }
    or None when nothing is in flight. The catalog refresh phases take
    priority over the embedding phase; in practice they don't overlap because
    the scheduler runs `refresh → schedule_sync` sequentially.
    """
    catalog = get_catalog_service()
    embeddings = get_embedding_service()

    refresh = catalog.refresh_state()
    if refresh is not None:
        return {
            "phase": refresh["phase"],
            "elapsed_seconds": refresh["elapsed_seconds"],
            "progress": refresh["progress"],
        }

    progress = embeddings.progress()
    if progress is not None:
        done, total = progress
        return {
            "phase": "embedding",
            "elapsed_seconds": None,
            "progress": {"done": done, "total": total},
        }

    return None


@router.get("/catalog")
async def get_catalog() -> dict[str, Any]:
    catalog = get_catalog_service()
    count = await catalog.count_movies()
    age = await catalog.data_age_seconds()
    embedded, _ = await get_embedding_service().coverage()
    collections = await catalog.get_collections()
    return {
        "count": count,
        "embedded": embedded,
        "age_seconds": age,
        "collections": [{"name": c.name, "size": c.size} for c in collections],
        "loading": _loading_payload(),
    }


@router.post("/catalog/refresh")
async def refresh_catalog() -> dict[str, Any]:
    catalog = get_catalog_service()
    count = await catalog.refresh_from_plex(force=True)
    movies = await catalog.search()
    await get_embedding_service().schedule_sync(movies)
    return {"count": count}
