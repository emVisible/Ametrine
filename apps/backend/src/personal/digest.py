from __future__ import annotations

import hashlib
import json
from collections import Counter
from datetime import date, datetime, timedelta

from . import decisions as decision_mod
from .canonical import GMT8, to_gmt8
from .memory import corrections, speech

SPANS = (
    ("这周", "week", 0), ("本周", "week", 0), ("这个星期", "week", 0),
    ("上周", "week", -1), ("上个星期", "week", -1),
    ("这个月", "month", 0), ("本月", "month", 0), ("上个月", "month", -1),
    ("这季度", "quarter", 0), ("这个季度", "quarter", 0),
    ("上季度", "quarter", -1), ("上个季度", "quarter", -1),
    ("今年", "year", 0), ("去年", "year", -1),
    ("最近", "recent", 14), ("这几天", "recent", 14),
    ("这段时间", "recent", 14), ("最近几天", "recent", 14),
    ("这阵子", "recent", 14),
    ("前阵子", "week", -1), ("前几天", "week", -1),
)
MAX_FIRST_LINES = 6
FIRST_LINE_CHARS = 40


def _day(value) -> date | None:
    try:
        return to_gmt8(str(value)).date()
    except (ValueError, TypeError):
        return None


def _period_key(day: date, level: str) -> str:
    if level == "week":
        year, week, _ = day.isocalendar()
        return f"{year:04d}-W{week:02d}"
    if level == "month":
        return day.strftime("%Y-%m")
    if level == "quarter":
        return f"{day.year:04d}-Q{(day.month - 1) // 3 + 1}"
    return f"{day.year:04d}"


def _period_range(key: str, level: str) -> tuple[str, str]:
    if level == "week":
        monday = date.fromisocalendar(int(key[:4]), int(key[6:]), 1)
        return monday.isoformat(), (monday + timedelta(days=6)).isoformat()
    if level == "month":
        first = date(int(key[:4]), int(key[5:7]), 1)
        nxt = date(first.year + (first.month == 12),
                   1 if first.month == 12 else first.month + 1, 1)
        return first.isoformat(), (nxt - timedelta(days=1)).isoformat()
    if level == "quarter":
        year, quarter = int(key[:4]), int(key[6:])
        first = date(year, 3 * quarter - 2, 1)
        end_month = 3 * quarter
        nxt = date(year + (end_month == 12),
                   1 if end_month == 12 else end_month + 1, 1)
        return first.isoformat(), (nxt - timedelta(days=1)).isoformat()
    return f"{int(key):04d}-01-01", f"{int(key):04d}-12-31"


def shift(key: str, level: str, offset: int) -> str:
    if offset == 0:
        return key
    if level == "week":
        monday = date.fromisocalendar(int(key[:4]), int(key[6:]), 1) + timedelta(weeks=offset)
        year, week, _ = monday.isocalendar()
        return f"{year:04d}-W{week:02d}"
    if level == "month":
        total = int(key[:4]) * 12 + (int(key[5:7]) - 1) + offset
        return f"{total // 12:04d}-{total % 12 + 1:02d}"
    if level == "quarter":
        total = int(key[:4]) * 4 + (int(key[6:]) - 1) + offset
        return f"{total // 4:04d}-Q{total % 4 + 1}"
    return f"{int(key) + offset:04d}"


def parse_span(text: str, rows: list[dict], today: date | None = None) -> dict | None:
    today = today or datetime.now(GMT8).date()
    last = None
    for row in reversed(rows):
        if speech(row):
            last = _day(row.get("occurred_at"))
            if last:
                break
    for word, level, spec in SPANS:
        if word not in (text or ""):
            continue
        if level == "recent":
            if last is None:
                return None
            end = last
            start = end - timedelta(days=spec - 1)
            return {"word": word, "level": "recent", "days": spec,
                    "key": f"{start.isoformat()[5:]}~{end.isoformat()[5:]}",
                    "start": start.isoformat(), "end": end.isoformat()}
        key = shift(_period_key(today, level), level, spec)
        start, end = _period_range(key, level)
        return {"word": word, "level": level, "key": key,
                "start": start, "end": end}
    return None


def of_range(rows: list[dict], start: str, end: str, *, key: str,
             level: str) -> dict:
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    spoken = []
    for row in rows:
        if not speech(row):
            continue
        day = _day(row.get("occurred_at"))
        if day and first <= day <= last:
            spoken.append(row)
    by_actor = Counter(row["actor"] for row in spoken)
    days: dict[str, dict] = {}
    for row in spoken:
        day = _day(row.get("occurred_at"))
        if day:
            days.setdefault(day.isoformat(), row)

    lines = []
    for day in sorted(days):
        row = days[day]
        text = " ".join((row.get("text") or "").split())
        lines.append({
            "date": day, "event_id": row["id"], "actor": row["actor"],
            "kind": row["kind"], "source": row.get("source"),
            "full_chars": len(text),
            "text": (text[:FIRST_LINE_CHARS] + "…"
                     if len(text) > FIRST_LINE_CHARS else text),
        })

    closed = corrections(rows)
    inside = {row["id"] for row in spoken}
    leads = [lead for lead in decision_mod.extract(rows, closed)
             if lead["event_id"] in inside and lead["status"] == "active"][:5]
    expired = [{"event_id": row["id"],
                "at": str(row.get("occurred_at") or "")[:10]}
               for row in spoken if closed.get(row["id"]) == "expired"]

    body = {
        "level": level, "key": key, "start": start, "end": end,
        "count": len(spoken), "days": len(days),
        "actors": [{"who": who, "n": n} for who, n in by_actor.most_common()],
        "first_of_day": lines,
        "decisions": [{"event_id": lead["event_id"], "actor": lead["actor"],
                       "marker": lead["marker"], "excerpt": lead["excerpt"],
                       "at": str(lead["at"])[:10]} for lead in leads],
        "expired": expired, "empty": not spoken,
    }
    body["digest"] = hashlib.sha256(
        json.dumps(body, sort_keys=True, ensure_ascii=False,
                   separators=(",", ":")).encode()).hexdigest()
    return body


def of(rows: list[dict], level: str, key: str) -> dict:
    start, end = _period_range(key, level)
    return of_range(rows, start, end, key=key, level=level)


def of_span(rows: list[dict], span: dict) -> dict:
    return of_range(rows, span["start"], span["end"], key=span["key"],
                    level=span["level"])
