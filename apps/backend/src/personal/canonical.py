from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone

GMT8 = timezone(timedelta(hours=8))
ZERO = "0" * 64
FIELDS = (
    "v", "seq", "id", "occurred_at", "recorded_at", "actor", "source", "kind",
    "text", "valid_from", "valid_until", "provenance", "prev", "hash",
)


def canonical(obj: dict) -> bytes:
    return json.dumps(obj, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":")).encode("utf-8")


def line_hash(row: dict) -> str:
    body = {key: row[key] for key in FIELDS if key != "hash"}
    return hashlib.sha256(canonical(body)).hexdigest()


def to_gmt8(value: str | datetime) -> datetime:
    stamp = (datetime.fromisoformat(value) if isinstance(value, str) else value)
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=GMT8)
    return stamp.astimezone(GMT8)


def iso(value: str | datetime) -> str:
    return to_gmt8(value).isoformat(timespec="microseconds")
