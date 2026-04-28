"""Tests for the content-hash logic in the embedding service.

DB-backed parts (similar_to / upsert) are covered by integration tests in
test_sessions_api when the DB is available.
"""

from __future__ import annotations

from app.services.embeddings import _content_hash, _embed_text_for


def test_content_hash_stable(sample_movies) -> None:
    movie = sample_movies[0]
    assert _content_hash(movie) == _content_hash(movie)


def test_content_hash_changes_on_summary(sample_movies) -> None:
    a = sample_movies[0]
    from dataclasses import replace

    b = replace(a, summary="Different summary now.")
    assert _content_hash(a) != _content_hash(b)


def test_content_hash_genre_order_irrelevant(sample_movies) -> None:
    from dataclasses import replace

    a = sample_movies[0]
    b = replace(a, genres=tuple(reversed(a.genres)))
    assert _content_hash(a) == _content_hash(b)


def test_embed_text_includes_metadata(sample_movies) -> None:
    text = _embed_text_for(sample_movies[0])
    assert "Matrix" in text
    assert "1999" in text
    assert "action" in text or "sci-fi" in text
