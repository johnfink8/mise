import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.recommendation import FeedbackStatus


class RecommendationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    session_id: uuid.UUID
    cycle: int
    position: int
    plex_rating_key: str
    title: str
    year: int | None
    reasoning: str
    group: str | None = None
    feedback: FeedbackStatus
    feedback_at: datetime | None
    created_at: datetime
    # Hydrated from the catalog at read time — not persisted per-recommendation.
    genres: list[str] = []
    synopsis: str = ""
    directors: list[str] = []
    cast: list[str] = []
    runtime_min: int | None = None
    content_rating: str | None = None
    audience_rating: float | None = None
    play_url: str | None = None


class FeedbackUpdate(BaseModel):
    feedback: FeedbackStatus = Field(...)
