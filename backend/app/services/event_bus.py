"""In-memory pub/sub for streaming session progress to SSE consumers."""

from __future__ import annotations

import asyncio
import contextlib
import uuid
from collections import defaultdict
from dataclasses import dataclass
from functools import lru_cache
from typing import Any


@dataclass
class Event:
    type: str
    data: dict[str, Any]


class EventBus:
    def __init__(self) -> None:
        self._subscribers: dict[uuid.UUID, list[asyncio.Queue[Event | None]]] = defaultdict(list)

    async def publish(self, session_id: uuid.UUID, event_type: str, data: dict[str, Any]) -> None:
        evt = Event(type=event_type, data=data)
        for q in list(self._subscribers.get(session_id, [])):
            await q.put(evt)

    async def close(self, session_id: uuid.UUID) -> None:
        for q in list(self._subscribers.get(session_id, [])):
            await q.put(None)

    def subscribe(self, session_id: uuid.UUID) -> asyncio.Queue[Event | None]:
        q: asyncio.Queue[Event | None] = asyncio.Queue()
        self._subscribers[session_id].append(q)
        return q

    def unsubscribe(self, session_id: uuid.UUID, q: asyncio.Queue[Event | None]) -> None:
        if session_id in self._subscribers:
            with contextlib.suppress(ValueError):
                self._subscribers[session_id].remove(q)
            if not self._subscribers[session_id]:
                del self._subscribers[session_id]


@lru_cache
def get_event_bus() -> EventBus:
    return EventBus()
