"""Tests for the agentic loop driver."""

from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest

from app.services.llm_service import (
    LLMService,
    LoopLimits,
    NoSubmissionError,
    TooManyToolCallsError,
    TooManyTurnsError,
)
from app.services.tools import ToolContext


class _Block:
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)


class _Response:
    def __init__(self, content, stop_reason="tool_use", usage=None):
        self.content = content
        self.stop_reason = stop_reason
        self.usage = usage or SimpleNamespace(input_tokens=10, output_tokens=20)


class FakeAnthropicClient:
    def __init__(self, scripted_responses: list[_Response]) -> None:
        self._responses = list(scripted_responses)
        self.calls = 0
        self.messages = self  # so `client.messages.create(...)` works

    async def create(self, **_kwargs):  # pragma: no cover - simple
        self.calls += 1
        if not self._responses:
            raise RuntimeError("no more scripted responses")
        return self._responses.pop(0)


async def _emit(_evt: str, _data: dict) -> None:
    return None


async def _record(*_args, **_kwargs) -> None:
    return None


@pytest.fixture
def ctx(fake_catalog, fake_embeddings) -> ToolContext:
    return ToolContext(catalog=fake_catalog, embeddings=fake_embeddings)


async def test_happy_path_two_turn_loop(ctx: ToolContext) -> None:
    # Turn 1: search_movies, Turn 2: submit_recommendations
    responses = [
        _Response(
            content=[
                _Block(
                    type="tool_use",
                    id="t1",
                    name="search_movies",
                    input={"genres": ["comedy"]},
                )
            ],
            stop_reason="tool_use",
        ),
        _Response(
            content=[
                _Block(
                    type="tool_use",
                    id="t2",
                    name="submit_recommendations",
                    input={
                        "recommendations": [
                            {"rating_key": "2", "reasoning": "Classic feel-good comedy."},
                            {"rating_key": "4", "reasoning": "Witty rom-com."},
                        ]
                    },
                )
            ],
            stop_reason="tool_use",
        ),
    ]
    client = FakeAnthropicClient(responses)
    svc = LLMService(client, "claude-sonnet-4-6", ctx, LoopLimits(max_turns=5, max_tool_calls=10))

    result = await svc.run(
        uuid.uuid4(),
        [{"role": "user", "content": "comedy please"}],
        _emit,
        _record,
    )

    assert len(result.recommendations) == 2
    assert result.recommendations[0]["rating_key"] == "2"
    assert result.tool_calls == 1
    assert result.turns == 2


async def test_hallucinated_rating_key_filtered(ctx: ToolContext) -> None:
    responses = [
        _Response(
            content=[
                _Block(
                    type="tool_use",
                    id="t1",
                    name="submit_recommendations",
                    input={
                        "recommendations": [
                            {"rating_key": "9999", "reasoning": "made up"},
                            {"rating_key": "2", "reasoning": "real one"},
                        ]
                    },
                )
            ],
            stop_reason="tool_use",
        ),
    ]
    svc = LLMService(FakeAnthropicClient(responses), "m", ctx)
    result = await svc.run(uuid.uuid4(), [{"role": "user", "content": "x"}], _emit, _record)
    assert [r["rating_key"] for r in result.recommendations] == ["2"]


async def test_max_turns_exceeded(ctx: ToolContext) -> None:
    # Always returns a tool_use that's not terminal, never submits
    forever = [
        _Response(
            content=[
                _Block(type="tool_use", id=f"t{i}", name="search_movies", input={}),
            ],
            stop_reason="tool_use",
        )
        for i in range(20)
    ]
    svc = LLMService(
        FakeAnthropicClient(forever), "m", ctx, LoopLimits(max_turns=3, max_tool_calls=100)
    )
    with pytest.raises(TooManyTurnsError):
        await svc.run(uuid.uuid4(), [{"role": "user", "content": "x"}], _emit, _record)


async def test_max_tool_calls_exceeded(ctx: ToolContext) -> None:
    forever = [
        _Response(
            content=[
                _Block(type="tool_use", id=f"a{i}", name="search_movies", input={}),
                _Block(type="tool_use", id=f"b{i}", name="search_movies", input={}),
            ],
            stop_reason="tool_use",
        )
        for i in range(20)
    ]
    svc = LLMService(
        FakeAnthropicClient(forever), "m", ctx, LoopLimits(max_turns=20, max_tool_calls=3)
    )
    with pytest.raises(TooManyToolCallsError):
        await svc.run(uuid.uuid4(), [{"role": "user", "content": "x"}], _emit, _record)


async def test_no_submission(ctx: ToolContext) -> None:
    responses = [
        _Response(
            content=[_Block(type="text", text="I have no idea")],
            stop_reason="end_turn",
        ),
    ]
    svc = LLMService(FakeAnthropicClient(responses), "m", ctx)
    with pytest.raises(NoSubmissionError):
        await svc.run(uuid.uuid4(), [{"role": "user", "content": "x"}], _emit, _record)


async def test_unknown_tool_returns_error_to_model(ctx: ToolContext) -> None:
    captured_tool_results: list = []

    class CaptureClient(FakeAnthropicClient):
        async def create(self, **kwargs):
            messages = kwargs.get("messages", [])
            for msg in messages:
                if msg.get("role") == "user" and isinstance(msg.get("content"), list):
                    for block in msg["content"]:
                        if isinstance(block, dict) and block.get("type") == "tool_result":
                            captured_tool_results.append(block)
            return await super().create(**kwargs)

    responses = [
        _Response(
            content=[
                _Block(type="tool_use", id="t1", name="bogus_tool", input={})
            ],
            stop_reason="tool_use",
        ),
        _Response(
            content=[
                _Block(
                    type="tool_use",
                    id="t2",
                    name="submit_recommendations",
                    input={"recommendations": [{"rating_key": "2", "reasoning": "ok"}]},
                )
            ],
            stop_reason="tool_use",
        ),
    ]
    svc = LLMService(CaptureClient(responses), "m", ctx)
    result = await svc.run(uuid.uuid4(), [{"role": "user", "content": "x"}], _emit, _record)
    assert len(result.recommendations) == 1
    # The bogus tool's result should have been sent back to the model
    assert any('"error"' in r["content"] for r in captured_tool_results)
