"""Agentic loop driver for Claude tool use.

Responsibilities:
- Build system prompt + tools (with prompt-cache markers).
- Drive the multi-turn loop, optionally resuming from prior message history.
- Dispatch tool calls to the registry, log them, emit progress events.
- Detect the terminal `submit_recommendations` tool and return its payload.
- Enforce safety caps (max turns, max tool calls).
"""

from __future__ import annotations

import json
import time
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, cast

import structlog
from anthropic import AsyncAnthropic
from anthropic.types import ToolUseBlock

from app.config import BASE_DIR
from app.services.tools import REGISTRY, ToolContext

log = structlog.get_logger()

_PROMPTS_DIR = BASE_DIR / "prompts"


def _load(name: str) -> str:
    return (_PROMPTS_DIR / name).read_text(encoding="utf-8").strip()


SYSTEM_PROMPT = _load("system.md")
_NUDGE_PROMPT = _load("nudge.md")


@dataclass
class LoopResult:
    recommendations: list[dict[str, Any]]  # [{rating_key, reasoning, group?}]
    messages: list[dict[str, Any]]  # full message history including this run
    turns: int
    tool_calls: int
    input_tokens: int
    output_tokens: int
    follow_up_suggestion: str | None = None


@dataclass
class LoopLimits:
    max_turns: int = 8
    max_tool_calls: int = 24


EmitFn = Callable[[str, dict[str, Any]], Awaitable[None]]
RecordToolCallFn = Callable[[int, str, dict[str, Any], dict[str, Any], int], Awaitable[None]]


class TooManyTurnsError(RuntimeError):
    pass


class TooManyToolCallsError(RuntimeError):
    pass


class NoSubmissionError(RuntimeError):
    pass


def build_tools_payload() -> list[dict[str, Any]]:
    tools = []
    items = list(REGISTRY.items())
    for idx, (_name, tool) in enumerate(items):
        entry: dict[str, Any] = {
            "name": tool.name,
            "description": tool.description,
            "input_schema": tool.input_schema,
        }
        # Cache the entire tools array by marking the last one ephemeral.
        if idx == len(items) - 1:
            entry["cache_control"] = {"type": "ephemeral"}
        tools.append(entry)
    return tools


def _serialize_content(content: Any) -> Any:
    """Convert anthropic SDK content blocks into JSON-safe dicts for persistence."""
    if isinstance(content, list):
        return [_serialize_content(item) for item in content]
    if hasattr(content, "model_dump"):
        return content.model_dump(mode="json")
    if isinstance(content, dict):
        return {k: _serialize_content(v) for k, v in content.items()}
    return content


class LLMService:
    def __init__(
        self,
        client: AsyncAnthropic,
        model: str,
        ctx: ToolContext,
        limits: LoopLimits | None = None,
    ) -> None:
        self._client = client
        self._model = model
        self._ctx = ctx
        self._limits = limits or LoopLimits()

    async def run(
        self,
        session_id: uuid.UUID,
        messages: list[dict[str, Any]],
        emit: EmitFn,
        record_tool_call: RecordToolCallFn,
    ) -> LoopResult:
        tools = build_tools_payload()

        turns = 0
        tool_call_count = 0
        input_tokens = 0
        output_tokens = 0

        while True:
            if turns >= self._limits.max_turns:
                raise TooManyTurnsError(f"exceeded {self._limits.max_turns} loop turns")

            turns += 1
            turn_started = time.monotonic()
            log.info("llm.turn.start", session_id=str(session_id), turn=turns)

            response = await self._client.messages.create(
                model=self._model,
                max_tokens=4096,
                system=[
                    {
                        "type": "text",
                        "text": SYSTEM_PROMPT,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                tools=tools,  # type: ignore[arg-type]
                messages=messages,  # type: ignore[arg-type]
            )

            usage = getattr(response, "usage", None)
            if usage is not None:
                input_tokens += int(getattr(usage, "input_tokens", 0) or 0)
                output_tokens += int(getattr(usage, "output_tokens", 0) or 0)
            log.info(
                "llm.turn.done",
                session_id=str(session_id),
                turn=turns,
                stop_reason=response.stop_reason,
                elapsed_ms=int((time.monotonic() - turn_started) * 1000),
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )

            tool_uses: list[ToolUseBlock] = [
                cast(ToolUseBlock, b)
                for b in response.content
                if getattr(b, "type", None) == "tool_use"
            ]
            text_blocks = [
                b.text
                for b in response.content
                if getattr(b, "type", None) == "text" and hasattr(b, "text")
            ]

            for txt in text_blocks:
                if txt.strip():
                    await emit("assistant_text", {"turn": turns, "text": txt})

            if not tool_uses:
                # Model returned only prose. Nudge once; if it still won't call tools, give up.
                if response.stop_reason == "end_turn":
                    raise NoSubmissionError("model stopped without calling submit_recommendations")
                messages.append(
                    {"role": "assistant", "content": _serialize_content(response.content)}
                )
                messages.append({"role": "user", "content": _NUDGE_PROMPT})
                continue

            # Check for terminal tool call
            terminal = next((tu for tu in tool_uses if tu.name == "submit_recommendations"), None)
            if terminal is not None:
                raw = terminal.input or {}
                recs = raw.get("recommendations", []) if isinstance(raw, dict) else []
                if not isinstance(recs, list):
                    recs = []
                # Filter against catalog (hallucination guard) — batch lookup.
                candidate_keys = [
                    str(r.get("rating_key", "")).strip()
                    for r in recs
                    if isinstance(r, dict) and str(r.get("rating_key", "")).strip()
                ]
                known_keys = (
                    set((await self._ctx.catalog.get_movies_by_keys(candidate_keys)).keys())
                    if candidate_keys
                    else set()
                )
                cleaned: list[dict[str, Any]] = []
                for r in recs:
                    if not isinstance(r, dict):
                        continue
                    rk = str(r.get("rating_key", "")).strip()
                    if not rk:
                        continue
                    if rk not in known_keys:
                        log.warning("llm.dropped_hallucinated_rk", rating_key=rk)
                        continue
                    group_raw = r.get("group")
                    group = str(group_raw).strip() if group_raw else None
                    cleaned.append(
                        {
                            "rating_key": rk,
                            "reasoning": str(r.get("reasoning", "")),
                            "group": group or None,
                        }
                    )
                follow_up_raw = raw.get("follow_up_suggestion") if isinstance(raw, dict) else None
                follow_up = (
                    str(follow_up_raw).strip()[:120] if follow_up_raw else None
                ) or None
                # Persist the assistant turn that contained the submit tool use, plus a synthetic
                # tool_result, so the conversation is consistent if the user follows up.
                messages.append(
                    {"role": "assistant", "content": _serialize_content(response.content)}
                )
                messages.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "tool_result",
                                "tool_use_id": terminal.id,
                                "content": json.dumps(
                                    {"submitted": True, "count": len(cleaned)}
                                ),
                            }
                        ],
                    }
                )
                return LoopResult(
                    recommendations=cleaned,
                    messages=messages,
                    turns=turns,
                    tool_calls=tool_call_count,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    follow_up_suggestion=follow_up,
                )

            # Execute non-terminal tools
            tool_results_content: list[dict[str, Any]] = []
            for tu in tool_uses:
                tool_call_count += 1
                if tool_call_count > self._limits.max_tool_calls:
                    raise TooManyToolCallsError(
                        f"exceeded {self._limits.max_tool_calls} tool calls"
                    )

                tool = REGISTRY.get(tu.name)
                tool_input = tu.input if isinstance(tu.input, dict) else {}
                await emit(
                    "tool_call_started",
                    {"turn": turns, "tool_name": tu.name, "tool_input": tool_input},
                )

                started = time.monotonic()
                if tool is None:
                    output: dict[str, Any] = {"error": f"unknown tool: {tu.name}"}
                else:
                    try:
                        output = await tool.execute(tool_input, self._ctx)
                    except Exception as exc:  # tool failures are non-fatal; report to model
                        log.exception("tool.exec_failed", tool=tu.name)
                        output = {"error": f"{type(exc).__name__}: {exc}"}
                duration_ms = int((time.monotonic() - started) * 1000)

                await emit(
                    "tool_call_completed",
                    {
                        "turn": turns,
                        "tool_name": tu.name,
                        "tool_input": tool_input,
                        "tool_output": output,
                        "duration_ms": duration_ms,
                    },
                )
                await record_tool_call(turns, tu.name, tool_input, output, duration_ms)

                tool_results_content.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tu.id,
                        "content": json.dumps(output, default=str),
                    }
                )

            messages.append(
                {"role": "assistant", "content": _serialize_content(response.content)}
            )
            messages.append({"role": "user", "content": tool_results_content})
