"""persist plex catalog (movies + collections) so we don't rescan on every boot

Revision ID: 0004_catalog_persistence
Revises: 0003_conversational
Create Date: 2026-04-27 00:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0004_catalog_persistence"
down_revision: str | None = "0003_conversational"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "movies",
        sa.Column("plex_rating_key", sa.String(64), primary_key=True),
        sa.Column("title", sa.Text, nullable=False),
        sa.Column("year", sa.Integer, nullable=True),
        sa.Column(
            "genres",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("summary", sa.Text, nullable=False, server_default=""),
        sa.Column("audience_rating", sa.Float, nullable=True),
        sa.Column("content_rating", sa.Text, nullable=True),
        sa.Column("duration_min", sa.Integer, nullable=True),
        sa.Column(
            "directors",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "top_cast",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("view_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("last_viewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("added_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "collections_list",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("thumb", sa.Text, nullable=True),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )
    op.create_index("ix_movies_last_seen", "movies", ["last_seen_at"])

    op.create_table(
        "plex_collections",
        sa.Column("name", sa.Text, primary_key=True),
        sa.Column("size", sa.Integer, nullable=False, server_default="0"),
        sa.Column(
            "rating_keys",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
    )


def downgrade() -> None:
    op.drop_table("plex_collections")
    op.drop_index("ix_movies_last_seen", table_name="movies")
    op.drop_table("movies")
