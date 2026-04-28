"""Persisted Plex collection row."""

from datetime import datetime

from sqlalchemy import DateTime, Integer, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class CatalogCollection(Base):
    __tablename__ = "catalog_collection"

    name: Mapped[str] = mapped_column(Text, primary_key=True)
    size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    rating_keys: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
