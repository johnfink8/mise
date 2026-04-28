import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.session import SessionStatus
from app.schemas.recommendation import RecommendationOut


class SessionFilters(BaseModel):
    genres: list[str] | None = None
    year_min: int | None = None
    year_max: int | None = None
    max_runtime: int | None = None
    watched_status: str | None = Field(None, pattern="^(watched|unwatched|any)$")


class SessionCreate(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000)
    count: int | None = Field(None, ge=1, le=25)
    filters: SessionFilters | None = None


class ToolCallOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    cycle: int
    turn: int
    tool_name: str
    tool_input: dict[str, Any] | None
    tool_output: dict[str, Any] | None
    duration_ms: int | None
    created_at: datetime


class SessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    user_prompt: str
    prompts: list[str] | None
    follow_up_suggestions: list[str | None] | None = None
    form_payload: dict[str, Any] | None
    model: str
    status: SessionStatus
    error_message: str | None
    latency_ms: int | None
    input_tokens: int | None
    output_tokens: int | None
    tool_calls_n: int | None


class SessionDetail(SessionOut):
    recommendations: list[RecommendationOut] = Field(default_factory=list)
    tool_calls: list[ToolCallOut] = Field(default_factory=list)


class SessionContinue(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=2000)


class SessionCreated(BaseModel):
    session_id: uuid.UUID


class SessionList(BaseModel):
    sessions: list[SessionOut]
    total: int
