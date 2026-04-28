"""initial schema with pgvector

Revision ID: 0001_init
Revises:
Create Date: 2026-04-26 00:00:00

"""

from collections.abc import Sequence

import pgvector.sqlalchemy
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import ENUM

from alembic import op
from app.config import get_settings

revision: str = "0001_init"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_status') THEN
                CREATE TYPE session_status AS ENUM ('pending', 'running', 'complete', 'error');
            END IF;
        END $$
    """)
    op.execute("""
        DO $$ BEGIN
            IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'feedback_status') THEN
                CREATE TYPE feedback_status AS ENUM ('none', 'up', 'down', 'watched');
            END IF;
        END $$
    """)

    op.create_table(
        "sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("user_prompt", sa.Text, nullable=False),
        sa.Column("form_payload", sa.JSON, nullable=True),
        sa.Column("model", sa.String(100), nullable=False),
        sa.Column(
            "status",
            ENUM(name="session_status", create_type=False),
            nullable=False,
        ),
        sa.Column("error_message", sa.Text, nullable=True),
        sa.Column("latency_ms", sa.Integer, nullable=True),
        sa.Column("input_tokens", sa.Integer, nullable=True),
        sa.Column("output_tokens", sa.Integer, nullable=True),
        sa.Column("tool_calls_n", sa.Integer, nullable=True),
    )
    op.create_index(
        "ix_sessions_created_at_desc",
        "sessions",
        [sa.text("created_at DESC")],
    )

    op.create_table(
        "recommendations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer, nullable=False),
        sa.Column("plex_rating_key", sa.String(64), nullable=False),
        sa.Column("title", sa.String(512), nullable=False),
        sa.Column("year", sa.Integer, nullable=True),
        sa.Column("reasoning", sa.Text, nullable=False, server_default=""),
        sa.Column(
            "feedback",
            ENUM(name="feedback_status", create_type=False),
            nullable=False,
            server_default="none",
        ),
        sa.Column("feedback_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_recommendations_session_position",
        "recommendations",
        ["session_id", "position"],
    )

    op.create_table(
        "tool_calls",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("turn", sa.Integer, nullable=False),
        sa.Column("tool_name", sa.String(64), nullable=False),
        sa.Column("tool_input", sa.JSON, nullable=True),
        sa.Column("tool_output", sa.JSON, nullable=True),
        sa.Column("duration_ms", sa.Integer, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_tool_calls_session_turn", "tool_calls", ["session_id", "turn"]
    )

    embedding_dim = get_settings().embedding_dim
    op.create_table(
        "movie_embeddings",
        sa.Column("plex_rating_key", sa.String(64), primary_key=True),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column(
            "embedding",
            pgvector.sqlalchemy.Vector(embedding_dim),
            nullable=False,
        ),
        sa.Column(
            "embedded_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.execute(
        "CREATE INDEX ix_movie_embeddings_hnsw "
        "ON movie_embeddings USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_movie_embeddings_hnsw")
    op.drop_table("movie_embeddings")
    op.drop_index("ix_tool_calls_session_turn", table_name="tool_calls")
    op.drop_table("tool_calls")
    op.drop_index("ix_recommendations_session_position", table_name="recommendations")
    op.drop_table("recommendations")
    op.drop_index("ix_sessions_created_at_desc", table_name="sessions")
    op.drop_table("sessions")
    sa.Enum(name="feedback_status").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="session_status").drop(op.get_bind(), checkfirst=True)
    op.execute("DROP EXTENSION IF EXISTS vector")
