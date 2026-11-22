from __future__ import annotations

from src.personal.decisions import extract
from src.personal.memory import keeps
from tests.test_personal_memory import row


def test_decision_marker_and_expiry():
    rows = [row(1, text="我决定用这个方案。", days=0)]
    leads = extract(rows, {})
    assert [lead["event_id"] for lead in leads] == ["ev-000001"]
    assert leads[0]["marker"] == "决定用"
    assert leads[0]["status"] == "active"


def test_retracted_sentence_is_not_a_lead():
    rows = [row(1, text="我决定用这个方案。", days=0)]
    assert extract(rows, {"ev-000001": "retracted"}) == []


def test_active_decision_keeps_its_sentence():
    rows = [row(1, text="我决定用这个方案。", days=20)]
    kept = keeps(rows)
    assert kept["ev-000001"] == ("decision",)
