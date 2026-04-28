"""Top-level orchestrator: creates sessions and runs the agentic loop in the background."""

from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.db import SessionLocal
from app.deps import get_anthropic_client
from app.models.recommendation import FeedbackStatus, Recommendation
from app.models.session import Session, SessionStatus
from app.models.tool_call import ToolCall
from app.services.catalog_service import get_catalog_service
from app.services.embeddings import get_embedding_service
from app.services.event_bus import get_event_bus
from app.services.llm_service import (
    LLMService,
    LoopLimits,
    NoSubmissionError,
    TooManyToolCallsError,
    TooManyTurnsError,
)
from app.services.plex_client import get_plex_client
from app.services.tools import ToolContext

log = structlog.get_logger()


class SessionNotReady(RuntimeError):
    pass


class Recommender:
    def __init__(self) -> None:
        settings = get_settings()
        self._settings = settings
        self._catalog = get_catalog_service()
        self._embeddings = get_embedding_service()
        self._bus = get_event_bus()
        self._plex_client = get_plex_client()
        self._llm = LLMService(
            client=get_anthropic_client(),
            model=settings.anthropic_model,
            ctx=ToolContext(catalog=self._catalog, embeddings=self._embeddings),
            limits=LoopLimits(
                max_turns=settings.max_loop_turns,
                max_tool_calls=settings.max_tool_calls,
            ),
        )

    async def create_session(
        self,
        db: AsyncSession,
        prompt: str,
        count: int | None,
        filters: dict[str, Any] | None,
    ) -> uuid.UUID:
        session = Session(
            user_prompt=prompt,
            prompts=[prompt],
            form_payload={"count": count, "filters": filters},
            model=self._settings.anthropic_model,
            status=SessionStatus.pending,
        )
        db.add(session)
        await db.commit()
        await db.refresh(session)
        initial = self._build_user_prompt(prompt, count, filters)
        asyncio.create_task(self._run(session.id, cycle=0, initial_user_message=initial))
        return session.id

    async def continue_session(
        self,
        db: AsyncSession,
        session_id: uuid.UUID,
        prompt: str,
    ) -> int:
        """Append a follow-up user prompt and kick off another agentic loop cycle.

        Returns the cycle index that will run.
        """
        obj = await db.get(Session, session_id)
        if obj is None:
            raise SessionNotReady("session not found")
        if obj.status not in (SessionStatus.complete, SessionStatus.error):
            raise SessionNotReady(f"session is {obj.status}; wait for it to finish")
        if not obj.messages:
            raise SessionNotReady("session has no message history to continue from")

        prompts = list(obj.prompts or [])
        prompts.append(prompt)
        obj.prompts = prompts
        obj.status = SessionStatus.pending
        obj.error_message = None
        await db.commit()

        cycle = self._next_cycle(prompts)
        asyncio.create_task(self._run(session_id, cycle=cycle, follow_up=prompt))
        return cycle

    @staticmethod
    def _next_cycle(prompts: list[str]) -> int:
        return max(0, len(prompts) - 1)

    async def _run(
        self,
        session_id: uuid.UUID,
        cycle: int,
        initial_user_message: str | None = None,
        follow_up: str | None = None,
    ) -> None:
        started = time.monotonic()
        sid = str(session_id)
        try:
            log.info("recommender.catalog.start", session_id=sid, cycle=cycle)
            # Ensure we have a populated catalog. Fresh data → instant no-op.
            # Empty/stale → blocks on the single-flight refresh lock so concurrent
            # requests share the same Plex fetch.
            count = await self._catalog.refresh_from_plex(force=False)
            log.info(
                "recommender.catalog.ready",
                session_id=sid,
                cycle=cycle,
                movie_count=count,
                elapsed_ms=int((time.monotonic() - started) * 1000),
            )

            async with SessionLocal() as db:
                session_obj = await db.get(Session, session_id)
                if session_obj is None:
                    raise RuntimeError(f"session {sid} disappeared before run")
                session_obj.status = SessionStatus.running
                prior_messages = list(session_obj.messages or [])
                await db.commit()

            messages: list[dict[str, Any]] = list(prior_messages)
            feedback_note = await self._build_feedback_note()
            if initial_user_message is not None:
                content = f"{feedback_note}\n\n{initial_user_message}" if feedback_note else initial_user_message
                messages.append({"role": "user", "content": content})
            elif follow_up is not None:
                content = f"{feedback_note}\n\n{follow_up}" if feedback_note else follow_up
                messages.append({"role": "user", "content": content})
            else:
                raise RuntimeError("recommender._run requires initial_user_message or follow_up")

            await self._bus.publish(session_id, "started", {"session_id": sid, "cycle": cycle})

            log.info("recommender.llm.start", session_id=sid, cycle=cycle)

            async def emit(event_type: str, data: dict[str, Any]) -> None:
                payload = {"cycle": cycle, **data}
                await self._bus.publish(session_id, event_type, payload)

            async def record_tool_call(
                turn: int,
                tool_name: str,
                tool_input: dict[str, Any],
                tool_output: dict[str, Any],
                duration_ms: int,
            ) -> None:
                async with SessionLocal() as db:
                    db.add(
                        ToolCall(
                            session_id=session_id,
                            cycle=cycle,
                            turn=turn,
                            tool_name=tool_name,
                            tool_input=tool_input,
                            tool_output=_truncate_json(tool_output),
                            duration_ms=duration_ms,
                        )
                    )
                    await db.commit()

            result = await self._llm.run(session_id, messages, emit, record_tool_call)
            log.info(
                "recommender.llm.done",
                session_id=sid,
                cycle=cycle,
                turns=result.turns,
                tool_calls=result.tool_calls,
                input_tokens=result.input_tokens,
                output_tokens=result.output_tokens,
                elapsed_ms=int((time.monotonic() - started) * 1000),
            )

            cleaned = result.recommendations[: self._settings.max_recommendations]

            async with SessionLocal() as db:
                await self._persist_recommendations(db, session_id, cycle, cleaned)
                await self._mark_complete(
                    db,
                    session_id,
                    messages=result.messages,
                    cycle_latency_ms=int((time.monotonic() - started) * 1000),
                    cycle_input_tokens=result.input_tokens,
                    cycle_output_tokens=result.output_tokens,
                    cycle_tool_calls=result.tool_calls,
                    follow_up_suggestion=result.follow_up_suggestion,
                    cycle=cycle,
                )

            payload = await self._fetch_recs_payload(session_id, cycle)
            await self._bus.publish(
                session_id,
                "recommendations_ready",
                {
                    "cycle": cycle,
                    "recommendations": payload,
                    "follow_up_suggestion": result.follow_up_suggestion,
                },
            )
        except (TooManyTurnsError, TooManyToolCallsError, NoSubmissionError) as exc:
            await self._fail(session_id, cycle, str(exc), started)
        except Exception as exc:
            log.exception("recommender.run_failed", session_id=str(session_id))
            await self._fail(session_id, cycle, f"{type(exc).__name__}: {exc}", started)

    async def _fail(
        self, session_id: uuid.UUID, cycle: int, message: str, started: float
    ) -> None:
        try:
            async with SessionLocal() as db:
                obj = await db.get(Session, session_id)
                if obj is not None:
                    obj.status = SessionStatus.error
                    obj.error_message = message
                    obj.latency_ms = (obj.latency_ms or 0) + int(
                        (time.monotonic() - started) * 1000
                    )
                    await db.commit()
        finally:
            await self._bus.publish(session_id, "error", {"cycle": cycle, "message": message})

    async def _mark_complete(
        self,
        db: AsyncSession,
        session_id: uuid.UUID,
        messages: list[dict[str, Any]],
        cycle_latency_ms: int,
        cycle_input_tokens: int,
        cycle_output_tokens: int,
        cycle_tool_calls: int,
        follow_up_suggestion: str | None,
        cycle: int,
    ) -> None:
        obj = await db.get(Session, session_id)
        if obj is None:
            return
        obj.status = SessionStatus.complete
        obj.messages = messages
        obj.latency_ms = (obj.latency_ms or 0) + cycle_latency_ms
        obj.input_tokens = (obj.input_tokens or 0) + cycle_input_tokens
        obj.output_tokens = (obj.output_tokens or 0) + cycle_output_tokens
        obj.tool_calls_n = (obj.tool_calls_n or 0) + cycle_tool_calls
        # Pad follow_up_suggestions to length cycle+1, then set this cycle.
        suggestions: list[str | None] = list(obj.follow_up_suggestions or [])
        while len(suggestions) <= cycle:
            suggestions.append(None)
        suggestions[cycle] = follow_up_suggestion
        obj.follow_up_suggestions = suggestions
        await db.commit()

    async def _persist_recommendations(
        self,
        db: AsyncSession,
        session_id: uuid.UUID,
        cycle: int,
        recs: list[dict[str, Any]],
    ) -> None:
        # Batch-resolve all rating_keys in one round-trip.
        keys = [r["rating_key"] for r in recs]
        by_key = await self._catalog.get_movies_by_keys(keys)
        for i, r in enumerate(recs, start=1):
            movie = by_key.get(r["rating_key"])
            if movie is None:
                continue
            db.add(
                Recommendation(
                    session_id=session_id,
                    cycle=cycle,
                    position=i,
                    plex_rating_key=movie.rating_key,
                    title=movie.title,
                    year=movie.year,
                    reasoning=r.get("reasoning", ""),
                    group=r.get("group"),
                )
            )
        await db.commit()

    async def _fetch_recs_payload(
        self,
        session_id: uuid.UUID,
        cycle: int,
    ) -> list[dict[str, Any]]:
        async with SessionLocal() as db:
            stmt = (
                select(Recommendation)
                .where(Recommendation.session_id == session_id, Recommendation.cycle == cycle)
                .order_by(Recommendation.position)
            )
            rows = (await db.execute(stmt)).scalars().all()
        # Batch-fetch movie metadata in one query.
        by_key = await self._catalog.get_movies_by_keys([r.plex_rating_key for r in rows])
        out: list[dict[str, Any]] = []
        for row in rows:
            movie = by_key.get(row.plex_rating_key)
            out.append(
                {
                    "id": str(row.id),
                    "cycle": cycle,
                    "position": row.position,
                    "rating_key": row.plex_rating_key,
                    "title": movie.title if movie else row.title,
                    "year": movie.year if movie else row.year,
                    "genres": list(movie.genres) if movie else [],
                    "synopsis": movie.summary if movie else "",
                    "directors": list(movie.directors) if movie else [],
                    "cast": list(movie.top_cast)[:3] if movie else [],
                    "runtime_min": movie.duration_min if movie else None,
                    "content_rating": movie.content_rating if movie else None,
                    "audience_rating": movie.audience_rating if movie else None,
                    "play_url": self._plex_client.web_url(row.plex_rating_key),
                    "reasoning": row.reasoning,
                    "group": row.group,
                }
            )
        return out

    async def _build_feedback_note(self) -> str:
        """Return a context string summarising all feedback the user has given across
        sessions. Deduplicates by title (most-recent rating wins) and caps at 30 entries
        so it doesn't bloat the context window."""
        async with SessionLocal() as db:
            stmt = (
                select(Recommendation)
                .where(Recommendation.feedback != FeedbackStatus.none)
                .order_by(Recommendation.feedback_at.desc())
                .limit(30)
            )
            rows = (await db.execute(stmt)).scalars().all()
        if not rows:
            return ""
        # Keep the most-recent rating per title.
        seen: dict[str, FeedbackStatus] = {}
        for r in rows:
            if r.title not in seen:
                seen[r.title] = r.feedback
        liked = [t for t, f in seen.items() if f == FeedbackStatus.up]
        disliked = [t for t, f in seen.items() if f == FeedbackStatus.down]
        watched = [t for t, f in seen.items() if f == FeedbackStatus.watched]
        parts: list[str] = []
        if liked:
            parts.append(f"The user liked: {', '.join(liked)}.")
        if disliked:
            parts.append(f"The user disliked: {', '.join(disliked)}.")
        if watched:
            parts.append(f"The user has already watched: {', '.join(watched)}.")
        return "Feedback from past recommendations: " + " ".join(parts)

    def _build_user_prompt(
        self,
        prompt: str,
        count: int | None,
        filters: dict[str, Any] | None,
    ) -> str:
        filter_block = ""
        if filters:
            non_null = {k: v for k, v in filters.items() if v not in (None, [], "")}
            if non_null:
                filter_block = f"\n\nStructured filters: {non_null}"
        if count:
            count_block = (
                f"\n\nThe user specifically asked for {count} recommendations — "
                "honour that and return a flat list of that size (no grouping)."
            )
        else:
            count_block = (
                "\n\nDecide how many recommendations to return based on the request "
                "(see the Sizing & Grouping guidance in your system prompt). "
                f"Hard cap: {self._settings.max_recommendations}."
            )
        return (
            f"User request: {prompt}"
            f"{filter_block}"
            f"{count_block}\n\n"
            "Use tools to discover candidates, then call `submit_recommendations`."
        )


def _truncate_json(obj: Any, max_chars: int = 500_000) -> Any:
    """Cap absurdly large tool outputs so we don't bloat the DB unboundedly."""
    import json

    s = json.dumps(obj, default=str)
    if len(s) <= max_chars:
        return obj
    return {"_truncated": True, "preview": s[:max_chars]}


_recommender: Recommender | None = None


def get_recommender() -> Recommender:
    global _recommender
    if _recommender is None:
        _recommender = Recommender()
    return _recommender
