"""Background job scheduler for catalog refresh and embedding sync."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from apscheduler import AsyncScheduler
from apscheduler.triggers.interval import IntervalTrigger

from app.config import get_settings
from app.services.catalog_service import get_catalog_service
from app.services.embeddings import get_embedding_service
from app.services.plex_client import get_plex_client

log = structlog.get_logger()


async def _refresh_and_sync(force: bool = False) -> None:
    """Refresh catalog from Plex if stale, then top up embeddings.

    Default `force=False` means: TTL drives the cadence. The periodic
    scheduler fires every `CATALOG_TTL_SECONDS`; at each fire the data is
    exactly TTL old (stale) so a refresh runs. This also avoids redundant
    Plex scans when APScheduler fires its first interval immediately on
    registration — data is fresh, the call no-ops.
    """
    catalog = get_catalog_service()
    embed = get_embedding_service()
    try:
        count = await catalog.refresh_from_plex(force=force)
        log.info("scheduler.catalog.done", count=count)
        # After a successful refresh, top up embeddings for new/changed rows.
        if count > 0:
            # Pull the freshly-persisted set (one query) for the embedding diff.
            movies = await catalog.search()
            await embed.schedule_sync(movies)
    except Exception as exc:
        log.warning("scheduler.catalog.failed", error=str(exc))


async def _warm_on_startup() -> None:
    """Reconcile with Plex on boot only if persisted data is stale, then make
    sure the PlexClient has handshaken so we have `machineIdentifier` ready
    for play-URL minting.

    Postgres is the source of truth, so requests work instantly as long as
    `catalog_movie` has any rows. With `force=False` the catalog refresh
    no-ops when data is younger than `CATALOG_TTL_SECONDS`; it only triggers
    a Plex refresh on first-ever boot or after long downtime.

    Even when we skip the refresh, we still want a quick connect so the Plex
    server identifier is cached — without it, `recommendation.play_url` would
    come back null for the first session after a fresh-data restart.
    """
    log.info("scheduler.warm.start")
    await _refresh_and_sync(force=False)
    plex = get_plex_client()
    try:
        await plex.ensure_connected()
    except Exception as exc:  # noqa: BLE001 — best-effort
        log.warning("scheduler.plex_connect_failed", error=str(exc))
    log.info("scheduler.warm.done")


@asynccontextmanager
async def lifespan_scheduler() -> AsyncIterator[None]:
    settings = get_settings()
    async with AsyncScheduler() as scheduler:
        await scheduler.add_schedule(
            _refresh_and_sync,
            IntervalTrigger(seconds=settings.catalog_ttl_seconds),
            id="catalog_refresh",
        )
        await scheduler.start_in_background()
        log.info("scheduler.started", interval_seconds=settings.catalog_ttl_seconds)

        # Background reconcile on startup. Doesn't block the lifespan yield;
        # the catalog service's single-flight lock means concurrent requests
        # join this refresh rather than starting their own.
        warm_task = asyncio.create_task(_warm_on_startup(), name="catalog_warm")
        try:
            yield
        finally:
            warm_task.cancel()
