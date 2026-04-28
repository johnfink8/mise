"""store per-cycle follow-up suggestions emitted by the model

Revision ID: 0007_followup_suggestions
Revises: 0006_recommendation_group
Create Date: 2026-04-27 00:00:00

The model now optionally emits a `follow_up_suggestion` alongside each
`submit_recommendations` call. We store one per cycle (indexed positionally
in this JSONB array) so the frontend can use it as a chat placeholder.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0007_followup_suggestions"
down_revision: str | None = "0006_recommendation_group"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "session",
        sa.Column("follow_up_suggestions", postgresql.JSONB, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("session", "follow_up_suggestions")
