from __future__ import annotations

from datetime import date, datetime, timedelta

from src.personal.canonical import GMT8, ZERO, line_hash
from src.personal.memory import survey

TODAY = date(2026, 11, 22)


def row(seq: int, *, text: str, kind: str = "ask", actor: str = "哥哥",
        source: str = "live", days: int = 0, provenance: dict | None = None,
        prev: str = ZERO) -> dict:
    stamp = (datetime(2026, 11, 22, 12, tzinfo=GMT8)
             - timedelta(days=days)).isoformat(timespec="microseconds")
    body = {
        "v": 1, "seq": seq, "id": f"ev-{seq:06d}",
        "occurred_at": stamp, "recorded_at": stamp, "actor": actor,
        "source": source, "kind": kind, "text": text,
        "valid_from": stamp, "valid_until": None,
        "provenance": provenance or {}, "prev": prev,
    }
    body["hash"] = line_hash(body)
    return body


def test_survey_matches_the_three_memory_layers():
    rows = [
        row(1, text="我喜欢这个", days=20),
        row(2, text="[pref] ev-000001", kind="pref", actor="isla",
            provenance={"pref_of": "ev-000001"}),
        row(3, text="我们在做构建", source="house", days=0),
        row(4, text="晚安", source="house", days=0),
        row(5, text="很久以前", days=30),
    ]
    out = survey([*rows, {
        **row(6, text="[label] ev-000004 life", kind="label"),
        "provenance": {"label_of": "ev-000004", "sitting": "life"},
    }], today=TODAY)
    assert out["counts"]["labile"] == 1
    assert out["counts"]["stable"] == 1
    assert out["counts"]["barred"] == 2
    assert out["counts"]["dormant"] == 1
    assert out["meter"]["count"] == 1
    assert {item["event_id"] for item in out["items"]} == {"ev-000001", "ev-000004"}


def test_retract_and_expiry_are_not_memories():
    rows = [
        row(1, text="撤回这句", days=0),
        row(2, text="[retract] ev-000001", kind="retract", actor="isla",
            provenance={"retract_of": "ev-000001"}),
        row(3, text="失效这句", days=0),
        row(4, text="[expiry] ev-000003", kind="expiry", actor="isla",
            provenance={"expiry_of": "ev-000003"}),
    ]
    out = survey(rows, today=TODAY)
    assert out["counts"]["barred"] == 3
    assert out["counts"]["retired"] == 1
    assert all(item["event_id"] != "ev-000001" for item in out["items"])


def test_labels_are_metadata_not_events():
    rows = [row(1, text="普通一句")]
    rows.append({
        **row(2, text="[label] ev-000001 work", kind="label"),
        "provenance": {"label_of": "ev-000001", "sitting": "work"},
    })
    out = survey(rows, today=TODAY)
    assert out["counts"]["barred"] == 1
    assert out["counts"]["labile"] == 0
