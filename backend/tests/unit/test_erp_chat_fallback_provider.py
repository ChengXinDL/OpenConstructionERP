# DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Issue #417 - the no-tool provider path in erp_chat.

Only Anthropic and OpenAI receive ``TOOL_DEFINITIONS``. Every other provider
(OpenRouter, Mistral, Groq, Ollama, ...) is called as plain text through
``_call_fallback``. That path used to send ``SYSTEM_PROMPT``, which advertises
~20 tools and orders "Always use tools first", while putting no tool schema on
the wire. Models did as instructed using their own call syntax and the literal
text reached the chat bubble - the reported symptom was a block of
``invoke name="list_projects"`` tags naming one of our own tools.

The same branch also returned out of ``stream_response`` before the shared
tail, which skipped persistence (so the thumbs feedback POST 404'd on a
client-side id, the "Last error captured" line of the report) and discarded
the token count (so the 24h budget was never charged for these providers).

These tests drive the real ``stream_response`` generator with the database
calls patched out and the provider response supplied from a fixture; nothing
contacts a provider.
"""

from __future__ import annotations

import inspect
import json
import uuid
from typing import Any

import httpx
import pytest

from app.modules.ai.ai_client import call_ai
from app.modules.erp_chat.prompts import SYSTEM_PROMPT
from app.modules.erp_chat.schemas import StreamChatRequest
from app.modules.erp_chat.service import ERPChatService


class _FakeSession:
    """Stand-in for the AsyncSession - ``stream_response`` only flushes it."""

    async def flush(self) -> None:
        return None


class _FakeChatSession:
    """Minimal ChatSession surface used by ``stream_response``."""

    def __init__(self) -> None:
        self.id = uuid.uuid4()
        self.project_id = None
        self.title = "Existing title"


def _frames(chunks: list[str], event: str) -> list[dict[str, Any]]:
    """Return the JSON payloads of every SSE frame of the given event type."""
    joined = "".join(chunks)
    payloads: list[dict[str, Any]] = []
    blocks = [b for b in joined.split("\n\n") if b.strip()]
    for block in blocks:
        lines = block.splitlines()
        if not lines or lines[0].strip() != f"event: {event}":
            continue
        for line in lines[1:]:
            if line.startswith("data:"):
                payloads.append(json.loads(line[len("data:") :].strip()))
    return payloads


def _streamed_text(chunks: list[str]) -> str:
    """Reassemble the assistant text from the chunked ``text`` frames."""
    return "".join(p.get("content", "") for p in _frames(chunks, "text"))


async def _drive(
    monkeypatch: pytest.MonkeyPatch,
    *,
    provider_text: str = "",
    provider_tokens: int = 42,
    provider_error: Exception | None = None,
    user_message: str = "Show all my projects",
) -> tuple[list[str], dict[str, Any], dict[str, Any]]:
    """Run one full turn against a non-tool provider.

    ``provider_error``, when given, is raised by the faked provider call
    instead of returning text.

    Returns (sse_chunks, captured call_ai kwargs, captured persist kwargs).
    """
    service = ERPChatService(_FakeSession())  # type: ignore[arg-type]
    chat_session = _FakeChatSession()
    captured_call: dict[str, Any] = {}
    captured_persist: dict[str, Any] = {}
    persisted_id = uuid.uuid4()

    async def _fake_call_ai(**kwargs: Any) -> tuple[str, int]:
        captured_call.update(kwargs)
        if provider_error is not None:
            raise provider_error
        return provider_text, provider_tokens

    # _call_fallback imports call_ai inside the function body, so patch it at
    # its definition site rather than on the erp_chat module.
    monkeypatch.setattr("app.modules.ai.ai_client.call_ai", _fake_call_ai)

    async def _fake_get_or_create(*_a: Any, **_k: Any) -> _FakeChatSession:
        return chat_session

    async def _fake_budget(_uid: str) -> tuple[bool, int]:
        return True, 0

    async def _fake_build_messages(*_a: Any, **_k: Any) -> list[dict[str, Any]]:
        return [{"role": "user", "content": user_message}]

    async def _fake_resolve(_uid: str) -> tuple[str, str, str | None]:
        return "openrouter", "test-key", None

    async def _fake_persist(
        _session: Any,
        _user_id: str,
        user_msg: str,
        assistant_text: str,
        tool_calls: Any,
        tool_results: Any,
        tokens_used: int,
    ) -> uuid.UUID:
        captured_persist.update(
            {
                "user_message": user_msg,
                "assistant_text": assistant_text,
                "tool_calls": tool_calls,
                "tool_results": tool_results,
                "tokens_used": tokens_used,
            }
        )
        return persisted_id

    monkeypatch.setattr(service, "get_or_create_session", _fake_get_or_create)
    monkeypatch.setattr(service, "check_daily_token_budget", _fake_budget)
    monkeypatch.setattr(service, "_build_messages", _fake_build_messages)
    monkeypatch.setattr(service, "_resolve_ai", _fake_resolve)
    monkeypatch.setattr(service, "_persist_messages", _fake_persist)

    req = StreamChatRequest(message=user_message)
    chunks: list[str] = []
    async for chunk in service.stream_response(str(uuid.uuid4()), req):
        chunks.append(chunk)

    captured_persist["_expected_id"] = persisted_id
    return chunks, captured_call, captured_persist


@pytest.mark.asyncio
async def test_no_tool_provider_is_not_told_it_has_tools(monkeypatch: pytest.MonkeyPatch) -> None:
    """The system prompt sent to a provider we call without a tool schema
    must not advertise tools - that mismatch is what made models emit call
    syntax as literal text (issue #417)."""
    _chunks, call_kwargs, _persist = await _drive(monkeypatch, provider_text="Sure.")

    system = call_kwargs["system"]

    # The tool-advertising prompt must not be the one on the wire.
    assert system != SYSTEM_PROMPT
    assert "You have access to live tools" not in system
    assert "Always use tools first" not in system

    # And the model is positively instructed the other way.
    assert "Never emit a tool call" in system
    assert "CANNOT query" in system

    # Tripwire, not a check on this call: the prompt above is only correct
    # BECAUSE call_ai has no way to carry a tool schema. The day someone adds
    # one, this choice has to be revisited rather than silently inherited.
    assert "tools" not in inspect.signature(call_ai).parameters, (
        "call_ai grew a 'tools' parameter - revisit SYSTEM_PROMPT_NO_TOOLS: "
        "providers that can now receive a tool schema should be told they have tools"
    )


@pytest.mark.asyncio
async def test_no_tool_provider_turn_is_persisted_and_returns_its_message_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The turn must reach the shared persistence tail, and ``done`` must
    carry the persisted assistant id.

    Without this the client keeps its optimistic bubble id and the thumbs
    feedback POST 404s - the error captured in the issue report.
    """
    chunks, _call_kwargs, persist = await _drive(
        monkeypatch, provider_text="Here is what I can tell you.", provider_tokens=137
    )

    # Persistence ran, with the assistant text of this turn.
    assert persist["assistant_text"] == "Here is what I can tell you."

    done = _frames(chunks, "done")
    assert len(done) == 1, f"expected exactly one done frame, got {done}"
    assert done[0]["message_id"] == str(persist["_expected_id"])


@pytest.mark.asyncio
async def test_no_tool_provider_tokens_are_counted_against_the_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Tokens spent on a no-tool provider must be accounted for.

    The old early return discarded ``call_ai``'s token count, so the 24h
    budget was never charged for any of these providers.
    """
    chunks, _call_kwargs, persist = await _drive(monkeypatch, provider_text="ok", provider_tokens=137)

    assert persist["tokens_used"] == 137
    done = _frames(chunks, "done")
    assert done[0]["tokens"] == 137


@pytest.mark.asyncio
async def test_provider_transport_failure_names_the_provider_and_ends_the_stream(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A failed provider call must say WHICH provider failed, terminate the
    stream once, and persist nothing.

    ``_call_fallback`` no longer swallows its own exceptions, so the shared
    handlers own this path. The common failures - 401 on a bad key, 429, 400
    on a retired model slug - reach them as ``httpx.HTTPStatusError`` from
    ``raise_for_status()``, not as ``ValueError``. Seventeen providers share
    this branch, so an unattributed error message is useless to the user.
    """
    request = httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions")
    response = httpx.Response(401, request=request)
    boom = httpx.HTTPStatusError("Unauthorized", request=request, response=response)

    chunks, _call_kwargs, persist = await _drive(monkeypatch, provider_error=boom)

    errors = _frames(chunks, "error")
    assert len(errors) == 1, f"expected exactly one error frame, got {errors}"
    assert "openrouter" in errors[0]["message"], (
        f"error frame does not name the failing provider: {errors[0]['message']}"
    )

    # The stream is terminated exactly once, and a failed turn stores nothing.
    assert len(_frames(chunks, "done")) == 1
    assert "assistant_text" not in persist
    assert _streamed_text(chunks) == ""


@pytest.mark.asyncio
async def test_assistant_text_that_looks_like_a_tool_call_is_never_altered(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Content that merely RESEMBLES a tool call must survive byte-for-byte.

    The fix removes the cause (the prompt) and deliberately adds no output
    scrubber, because a pattern that deletes "tool-call-looking" text would
    silently eat a legitimate answer. This is the guard on that decision: a
    genuine assistant reply explaining the very tag syntax from the bug
    report - including a real tool name of ours - must pass through the SSE
    text frames unmodified.
    """
    # Deliberately hostile: the exact shape from the issue screenshot, a
    # fenced JSON block naming a real tool, and prose about it.
    legitimate = (
        "Those tags come from the model, not from the ERP. A provider that "
        "lacks tool support may print <|DSML|tool_calls> and\n"
        '<|DSML|invoke name="list_projects"> instead of calling anything.\n'
        "```json\n"
        '{"name": "get_all_projects", "arguments": {}}\n'
        "```\n"
        '<tool_call>{"name": "get_all_projects"}</tool_call>\n'
        "Switch the provider under Settings > AI to enable live queries."
    )

    chunks, _call_kwargs, persist = await _drive(monkeypatch, provider_text=legitimate)

    # Nothing was stripped, reordered or re-encoded on the wire...
    assert _streamed_text(chunks) == legitimate
    # ...nor on the way into the database.
    assert persist["assistant_text"] == legitimate
