from __future__ import annotations

from datetime import date, datetime

from src.personal.canonical import GMT8
from src.personal.periods import list_periods, parent_keys, period_key, period_range


def test_iso_week_and_parents():
    day = date(2026, 11, 22)
    assert period_key(day, "week") == "2026-W47"
    assert period_range("2026-W47", "week") == ("2026-11-16", "2026-11-22")
    assert parent_keys("2026-W47", "week") == ["2026-11"]


def test_month_quarter_year_keys():
    day = date(2026, 11, 22)
    assert period_key(day, "month") == "2026-11"
    assert period_key(day, "quarter") == "2026-Q4"
    assert period_key(day, "year") == "2026"
    assert period_range("2026-Q4", "quarter") == ("2026-10-01", "2026-12-31")


def test_list_periods_counts_ids_without_loading_texts():
    rows = [
        {"id": "ev-1", "occurred_at": datetime(2026, 11, 16, 10, tzinfo=GMT8)},
        {"id": "ev-2", "occurred_at": datetime(2026, 11, 22, 10, tzinfo=GMT8)},
        {"id": "ev-3", "occurred_at": datetime(2026, 11, 9, 10, tzinfo=GMT8)},
    ]
    weeks = list_periods(rows, "week")
    assert [w["period_key"] for w in weeks] == ["2026-W46", "2026-W47"]
    assert weeks[-1]["item_count"] == 2
