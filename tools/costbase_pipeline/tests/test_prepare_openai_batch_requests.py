from __future__ import annotations

import json

from prepare_openai_batch_requests import convert_batch


def test_convert_batch_creates_chat_completion_request(tmp_path) -> None:
    source = tmp_path / "in.jsonl"
    source.write_text(
        json.dumps(
            {
                "custom_id": "tm:k1:de:v1",
                "tm_key": "k1",
                "source_lang": "tr",
                "target_lang": "de",
                "source_text": "Yükleyici (100 HP)",
                "protected_tokens": ["100 HP"],
            }
        )
        + "\n",
        encoding="utf-8",
    )
    out = tmp_path / "requests.jsonl"
    assert convert_batch(source, out, "gpt-4.1-mini") == 1
    request = json.loads(out.read_text(encoding="utf-8"))
    assert request["custom_id"] == "tm:k1:de:v1"
    assert request["method"] == "POST"
    assert request["url"] == "/v1/chat/completions"
    assert request["body"]["response_format"] == {"type": "json_object"}
