"""add optional group label to recommendation for thematic subdivisions

Revision ID: 0006_recommendation_group
Revises: 0005_rename_tables
Create Date: 2026-04-27 00:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "0006_recommendation_group"
down_revision: str | None = "0005_rename_tables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "recommendation",
        sa.Column("group", sa.Text, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("recommendation", "group")
