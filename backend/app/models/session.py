import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, DateTime, Enum, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.recommendation import Recommendation
    from app.models.tool_call import ToolCall


class SessionStatus(enum.StrEnum):
    pending = "pending"
    running = "running"
    complete = "complete"
    error = "error"


class Session(Base):
    __tablename__ = "session"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    user_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    form_payload: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[SessionStatus] = mapped_column(
        Enum(SessionStatus, name="session_status"),
        nullable=False,
        default=SessionStatus.pending,
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tool_calls_n: Mapped[int | None] = mapped_column(Integer, nullable=True)
    messages: Mapped[list[dict[str, Any]] | None] = mapped_column(JSONB, nullable=True)
    prompts: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)
    follow_up_suggestions: Mapped[list[str | None] | None] = mapped_column(
        JSONB, nullable=True
    )

    recommendations: Mapped[list["Recommendation"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="Recommendation.cycle, Recommendation.position",
    )
    tool_calls: Mapped[list["ToolCall"]] = relationship(
        back_populates="session",
        cascade="all, delete-orphan",
        order_by="ToolCall.cycle, ToolCall.turn, ToolCall.created_at",
    )
