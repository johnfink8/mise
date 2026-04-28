"""rename tables + indexes to singular snake_case matching their model class

Revision ID: 0005_rename_tables
Revises: 0004_catalog_persistence
Create Date: 2026-04-27 00:00:00

Tablename now matches snake_case(class name):
  sessions          -> session
  recommendations   -> recommendation
  tool_calls        -> tool_call
  movie_embeddings  -> movie_embedding
  movies            -> catalog_movie
  plex_collections  -> catalog_collection

Foreign keys reference table OIDs internally, so they survive table renames
without further changes. Index and primary-key constraint names have the old
table name baked in, so we rename those explicitly to keep things tidy.
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0005_rename_tables"
down_revision: str | None = "0004_catalog_persistence"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# (old_name, new_name) — order matters for FK resolution? No: PG renames don't
# break FKs. But we still rename parents before children for readability.
TABLE_RENAMES = [
    ("sessions", "session"),
    ("recommendations", "recommendation"),
    ("tool_calls", "tool_call"),
    ("movie_embeddings", "movie_embedding"),
    ("movies", "catalog_movie"),
    ("plex_collections", "catalog_collection"),
]

# (old_index_name, new_index_name)
INDEX_RENAMES = [
    ("ix_sessions_created_at_desc", "ix_session_created_at_desc"),
    ("sessions_pkey", "session_pkey"),
    ("ix_recommendations_session_position", "ix_recommendation_session_position"),
    ("recommendations_pkey", "recommendation_pkey"),
    ("ix_tool_calls_session_turn", "ix_tool_call_session_turn"),
    ("tool_calls_pkey", "tool_call_pkey"),
    ("ix_movie_embeddings_hnsw", "ix_movie_embedding_hnsw"),
    ("movie_embeddings_pkey", "movie_embedding_pkey"),
    ("ix_movies_last_seen", "ix_catalog_movie_last_seen"),
    ("movies_pkey", "catalog_movie_pkey"),
    ("plex_collections_pkey", "catalog_collection_pkey"),
]


def upgrade() -> None:
    for old, new in TABLE_RENAMES:
        op.rename_table(old, new)
    for old, new in INDEX_RENAMES:
        op.execute(f'ALTER INDEX "{old}" RENAME TO "{new}"')


def downgrade() -> None:
    for old, new in INDEX_RENAMES:
        op.execute(f'ALTER INDEX "{new}" RENAME TO "{old}"')
    for old, new in TABLE_RENAMES:
        op.rename_table(new, old)
