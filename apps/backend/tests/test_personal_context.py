from __future__ import annotations

from datetime import date

from src.personal.context import compose
from tests.test_personal_memory import TODAY, row


def test_context_contains_only_held_rows_and_keeps_ids():
    rows = [
        row(1, text="今天很好", days=0),
        row(2, text="我喜欢这个", days=20),
        row(3, text="[pref] ev-000002", kind="pref", actor="isla",
            provenance={"pref_of": "ev-000002"}),
        row(4, text="构建谈话", source="house", days=0),
    ]
    out = compose(rows, today=TODAY)
    assert "ev-000001" in out["prompt"]
    assert "ev-000002" in out["prompt"]
    assert "ev-000004" not in out["prompt"]
    assert {item["id"] for item in out["references"]} == {"ev-000001", "ev-000002"}
    assert out["event_ids"] == ["ev-000002", "ev-000001"]


def test_empty_memory_composes_nothing():
    out = compose([row(1, text="很久以前", days=30)], today=TODAY)
    assert out == {"prompt": "", "references": [], "event_ids": []}
