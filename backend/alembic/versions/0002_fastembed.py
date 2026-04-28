"""switch embeddings to fastembed (384-dim bge-small-en-v1.5)

Revision ID: 0002_fastembed
Revises: 0001_init
Create Date: 2026-04-26 00:00:00

"""

from collections.abc import Sequence

import pgvector.sqlalchemy
import sqlalchemy as sa

from alembic import op

revision: str = "0002_fastembed"
down_revision: str | None = "0001_init"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_movie_embeddings_hnsw")
    op.execute("TRUNCATE TABLE movie_embeddings")
    op.drop_column("movie_embeddings", "embedding")
    op.add_column(
        "movie_embeddings",
        sa.Column("embedding", pgvector.sqlalchemy.Vector(384), nullable=False),
    )
    op.execute(
        "CREATE INDEX ix_movie_embeddings_hnsw "
        "ON movie_embeddings USING hnsw (embedding vector_cosine_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_movie_embeddings_hnsw")
    op.execute("TRUNCATE TABLE movie_embeddings")
    op.drop_column("movie_embeddings", "embedding")
    op.add_column(
        "movie_embeddings",
        sa.Column("embedding", pgvector.sqlalchemy.Vector(1024), nullable=False),
    )
    op.execute(
        "CREATE INDEX ix_movie_embeddings_hnsw "
        "ON movie_embeddings USING hnsw (embedding vector_cosine_ops)"
    )
