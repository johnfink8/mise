import json
import uuid
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sse_starlette.sse import EventSourceResponse

from app.deps import get_db
from app.models.session import Session
from app.schemas.recommendation import RecommendationOut
from app.schemas.session import (
    SessionContinue,
    SessionCreate,
    SessionCreated,
    SessionDetail,
    SessionList,
    SessionOut,
)
from app.services.catalog_service import get_catalog_service
from app.services.event_bus import get_event_bus
from app.services.plex_client import get_plex_client
from app.services.recommender import SessionNotReady, get_recommender

router = APIRouter(tags=["sessions"])

DbSession = Annotated[AsyncSession, Depends(get_db)]


@router.post("/sessions", response_model=SessionCreated, status_code=202)
async def create_session(body: SessionCreate, db: DbSession) -> SessionCreated:
    recommender = get_recommender()
    filters = body.filters.model_dump(exclude_none=True) if body.filters else None
    session_id = await recommender.create_session(db, body.prompt, body.count, filters)
    return SessionCreated(session_id=session_id)


@router.post("/sessions/{session_id}/messages", response_model=SessionCreated, status_code=202)
async def continue_session(
    session_id: uuid.UUID, body: SessionContinue, db: DbSession
) -> SessionCreated:
    recommender = get_recommender()
    try:
        await recommender.continue_session(db, session_id, body.prompt)
    except SessionNotReady as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return SessionCreated(session_id=session_id)


@router.get("/sessions", response_model=SessionList)
async def list_sessions(
    db: DbSession,
    limit: int = 20,
    offset: int = 0,
) -> SessionList:
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    total = (await db.execute(select(func.count(Session.id)))).scalar() or 0
    rows = (
        await db.execute(
            select(Session).order_by(desc(Session.created_at)).limit(limit).offset(offset)
        )
    ).scalars().all()
    return SessionList(
        sessions=[SessionOut.model_validate(r) for r in rows],
        total=int(total),
    )


@router.get("/sessions/{session_id}", response_model=SessionDetail)
async def get_session(session_id: uuid.UUID, db: DbSession) -> SessionDetail:
    obj = (
        await db.execute(
            select(Session)
            .where(Session.id == session_id)
            .options(selectinload(Session.recommendations), selectinload(Session.tool_calls))
        )
    ).scalar_one_or_none()
    if obj is None:
        raise HTTPException(status_code=404, detail="session not found")

    # Hydrate recommendation rows with catalog metadata (synopsis, director,
    # cast, etc.) that we don't denormalize onto the rec table itself.
    catalog = get_catalog_service()
    by_key = await catalog.get_movies_by_keys(
        [r.plex_rating_key for r in obj.recommendations]
    )
    detail = SessionDetail.model_validate(obj)
    plex = get_plex_client()
    hydrated: list[RecommendationOut] = []
    for rec in detail.recommendations:
        movie = by_key.get(rec.plex_rating_key)
        if movie:
            rec = rec.model_copy(
                update={
                    "genres": list(movie.genres),
                    "synopsis": movie.summary,
                    "directors": list(movie.directors),
                    "cast": list(movie.top_cast)[:3],
                    "runtime_min": movie.duration_min,
                    "content_rating": movie.content_rating,
                    "audience_rating": movie.audience_rating,
                    "play_url": plex.web_url(rec.plex_rating_key),
                }
            )
        hydrated.append(rec)
    return detail.model_copy(update={"recommendations": hydrated})


@router.get("/sessions/{session_id}/stream")
async def stream_session(session_id: uuid.UUID) -> EventSourceResponse:
    bus = get_event_bus()
    queue = bus.subscribe(session_id)

    async def gen() -> AsyncIterator[dict[str, Any]]:
        try:
            while True:
                evt = await queue.get()
                if evt is None:
                    yield {"event": "done", "data": "{}"}
                    return
                yield {"event": evt.type, "data": json.dumps(evt.data, default=str)}
        finally:
            bus.unsubscribe(session_id, queue)

    return EventSourceResponse(gen())
