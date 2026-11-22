from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from datetime import date, timedelta

LEVELS = ("week", "month", "quarter", "year")


def period_key(day: date, level: str) -> str:
    if level == "week":
        year, week, _ = day.isocalendar()
        return f"{year:04d}-W{week:02d}"
    if level == "month":
        return day.strftime("%Y-%m")
    if level == "quarter":
        return f"{day.year:04d}-Q{(day.month - 1) // 3 + 1}"
    return f"{day.year:04d}"


def period_range(key: str, level: str) -> tuple[str, str]:
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


def parent_keys(key: str, level: str) -> list[str]:
    if level == "week":
        day = date.fromisocalendar(int(key[:4]), int(key[6:]), 1)
        return [day.strftime("%Y-%m")]
    if level == "month":
        day = date(int(key[:4]), int(key[5:7]), 1)
        return [f"{day.year:04d}-Q{(day.month - 1) // 3 + 1}"]
    if level == "quarter":
        return [key[:4]]
    return []


def digest(ids: list[str]) -> str:
    body = json.dumps(ids, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(body.encode()).hexdigest()


def catalog(rows: list[dict], start: str, end: str) -> list[dict]:
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    out = []
    for row in rows:
        day = row["occurred_at"].date()
        if first <= day <= last:
            out.append({
                "date": day.isoformat(),
                "session": str((row.get("provenance") or {}).get("session_id") or ""),
                "actor": row["actor"], "kind": row["kind"], "id": row["id"],
                "first_line": (row["text"] or "").splitlines()[0][:80],
            })
    return out


def list_periods(rows: list[dict], level: str) -> list[dict]:
    buckets: dict[str, list[str]] = defaultdict(list)
    for row in rows:
        buckets[period_key(row["occurred_at"].date(), level)].append(row["id"])
    out = []
    for key in sorted(buckets):
        start, end = period_range(key, level)
        out.append({"level": level, "period_key": key,
                    "start_date": start, "end_date": end,
                    "item_count": len(buckets[key]),
                    "content_digest": digest(buckets[key]),
                    "parent_keys": parent_keys(key, level)})
    return out
