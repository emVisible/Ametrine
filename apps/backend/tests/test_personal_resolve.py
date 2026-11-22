from __future__ import annotations

from src.personal import aliases, resolve
from tests.test_personal_memory import row


def _rows():
    return [
        row(1, text="叫我弟弟。我是老二。", actor="哥哥", days=2,
            provenance={"session_id": "s1"}),
        row(2, text="宵明是姐姐 老大，烛徽是妹妹 老三。", actor="哥哥", days=2,
            provenance={"session_id": "s1"}),
        row(3, text="我们三个是 宵明/烛徽/艾拉。", actor="哥哥", days=2,
            provenance={"session_id": "s1"}),
        row(4, text="昨天我们三个聊了那个决定。", actor="哥哥", days=1,
            provenance={"session_id": "s2"}),
        row(5, text="早。", actor="宵明", days=2),
        row(6, text="早。", actor="烛徽", days=2),
        row(7, text="早。", actor="艾拉", days=2),
    ]


def test_aliases_and_group_are_traced_to_the_sentence():
    found = aliases.extract(_rows())
    names = {(item["alias"], item["actor"]) for item in found["aliases"]}
    assert ("弟弟", "哥哥") in names
    assert ("老二", "哥哥") in names
    assert found["groups"][0]["name"] == "我们三个"
    assert found["groups"][0]["members"] == ["宵明", "烛徽", "艾拉"]


def test_date_and_group_resolve_from_the_ledger():
    rows = _rows()
    out = resolve.resolve_text(rows, "昨天我们三个", actor="哥哥",
                               at="2026-11-22T12:00:00+08:00", session="s2")
    items = {item["phrase"]: item for item in out["phrases"]}
    assert items["昨天"]["status"] == "resolved"
    assert items["昨天"]["labels"] == ["2026-11-21"]
    assert items["我们三个"]["status"] == "resolved"
    assert items["我们三个"]["labels"] == ["宵明", "烛徽", "艾拉"]


def test_unregistered_reference_is_refused_not_guessed():
    out = resolve.resolve_text(_rows(), "那个决定呢", actor="哥哥",
                               at="2026-11-22T12:00:00+08:00", session="s2")
    assert out["refused"] >= 1
    assert out["phrases"][0]["kind"] == "unregistered"
