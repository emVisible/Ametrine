from __future__ import annotations

from src.personal.ontology import build
from tests.test_personal_memory import row


def test_graph_has_people_days_and_terms():
    rows = [
        row(1, text="`记忆`要留下。", actor="哥哥", days=0,
            provenance={"session_id": "s1", "archive_date": "2026-11-22"}),
        row(2, text="同意。", actor="艾拉", days=0,
            provenance={"session_id": "s1", "archive_date": "2026-11-22"}),
    ]
    graph = build(rows)
    labels = {entity["id"] for entity in graph["entities"]}
    assert "actor:哥哥" in labels
    assert "actor:艾拉" in labels
    assert "date:2026-11-22" in labels
    assert "term:记忆" in labels
    assert graph["counts"]["relations"] == 1
    assert graph["content_digest"]
