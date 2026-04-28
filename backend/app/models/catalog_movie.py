"""Persisted Plex movie row so we don't rescan the library on every boot."""

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Float, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class CatalogMovie(Base):
    __tablename__ = "catalog_movie"

    plex_rating_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    genres: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    audience_rating: Mapped[float | None] = mapped_column(Float, nullable=True)
    content_rating: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    directors: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    top_cast: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    view_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_viewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    added_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    collections_list: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    thumb: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def to_dict(self) -> dict[str, Any]:
        return {
            "plex_rating_key": self.plex_rating_key,
            "title": self.title,
            "year": self.year,
            "genres": list(self.genres or []),
            "summary": self.summary,
            "audience_rating": self.audience_rating,
            "content_rating": self.content_rating,
            "duration_min": self.duration_min,
            "directors": list(self.directors or []),
            "top_cast": list(self.top_cast or []),
            "view_count": self.view_count,
            "last_viewed_at": self.last_viewed_at,
            "added_at": self.added_at,
            "collections_list": list(self.collections_list or []),
            "thumb": self.thumb,
        }
