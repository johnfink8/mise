"""Integration tests for the sessions API.

Requires a running Postgres (CI provides one via `services:`). Skipped if
DATABASE_URL is unreachable.
"""

from __future__ import annotations

import asyncio

import httpx
import pytest
import sqlalchemy

from app.config import get_settings
from app.db import engine
from app.main import app


def _db_reachable() -> bool:
    try:
        sync_url = get_settings().database_url.replace(
            "postgresql+psycopg://", "postgresql+psycopg://"
        )
        eng = sqlalchemy.create_engine(sync_url)
        with eng.connect() as conn:
            conn.execute(sqlalchemy.text("SELECT 1"))
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _db_reachable(), reason="Postgres not reachable")


@pytest.fixture(scope="module", autouse=True)
def _migrate() -> None:
    """Run alembic migrations against the test DB once per module."""
    from alembic.config import Config

    from alembic import command

    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", get_settings().database_url)
    command.upgrade(cfg, "head")
    yield
    # Leave schema in place; CI tears down the DB.


async def test_health_ok() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/health")
        assert resp.status_code == 200
        body = resp.json()
        assert body["db"] == "ok"


async def test_create_session_returns_id(monkeypatch) -> None:
    """POST /api/sessions returns 202 + session_id even before the loop runs.

    We patch the recommender to a no-op so we don't hit external services.
    """
    from app.services import recommender as rec_module

    class _StubRec:
        async def create_session(self, db, prompt, count, filters):
            from uuid import uuid4

            return uuid4()

    monkeypatch.setattr(rec_module, "_recommender", _StubRec())

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.post(
            "/api/sessions",
            json={"prompt": "feel-good comedy"},
        )
        assert resp.status_code == 202
        assert "session_id" in resp.json()


async def test_list_sessions_empty_or_present() -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        resp = await client.get("/api/sessions")
        assert resp.status_code == 200
        body = resp.json()
        assert "sessions" in body and "total" in body


@pytest.mark.asyncio
async def test_engine_connects() -> None:
    async with engine.connect() as conn:
        result = await conn.execute(sqlalchemy.text("SELECT 1"))
        assert result.scalar() == 1
    # Avoid event-loop leakage
    await asyncio.sleep(0)
