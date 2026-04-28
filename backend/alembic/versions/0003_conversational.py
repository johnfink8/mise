"""conversational sessions: messages history, prompts list, cycle index

Revision ID: 0003_conversational
Revises: 0002_fastembed
Create Date: 2026-04-27 00:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0003_conversational"
down_revision: str | None = "0002_fastembed"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("messages", postgresql.JSONB, nullable=True),
    )
    op.add_column(
        "sessions",
        sa.Column("prompts", postgresql.JSONB, nullable=True),
    )
    op.execute("UPDATE sessions SET prompts = jsonb_build_array(user_prompt) WHERE prompts IS NULL")

    op.add_column(
        "recommendations",
        sa.Column("cycle", sa.Integer, nullable=False, server_default="0"),
    )
    op.add_column(
        "tool_calls",
        sa.Column("cycle", sa.Integer, nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("tool_calls", "cycle")
    op.drop_column("recommendations", "cycle")
    op.drop_column("sessions", "prompts")
    op.drop_column("sessions", "messages")
