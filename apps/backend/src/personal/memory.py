from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone

ENGINEERING = frozenset({"workbuddy", "opencode", "console", "discuss"})
SPEECH_KINDS = frozenset({"ask", "answer", "reply"})
SHORT_DAYS = 7
HER_LONG = 400
GMT8 = timezone(timedelta(hours=8))


def _rows(payloads: list[dict]) -> list[dict]:
    return [row for row in payloads if isinstance(row, dict)]


def labels(rows: list[dict]) -> dict[str, str]:
    out: dict[str, str] = {}
    for row in rows:
        if row.get("kind") != "label":
            continue
        prov = row.get("provenance") or {}
        target = prov.get("label_of")
        sitting = prov.get("sitting")
        if isinstance(target, str) and sitting in ("work", "life"):
            out[target] = sitting
    return out


def speech(row: dict) -> bool:
    if not row or row.get("source") in ENGINEERING:
        return False
    if row.get("kind") not in SPEECH_KINDS:
        return False
    text = row.get("text") or ""
    if row.get("actor") != "哥哥" and len(text) > HER_LONG:
        return False
    return True


def work(row: dict, sitting: dict[str, str] | None = None) -> bool:
    if not row:
        return False
    prov = row.get("provenance") or {}
    if prov.get("sitting") == "work":
        return True
    if prov.get("sitting") == "life":
        return False
    value = (sitting or {}).get(str(row.get("id") or ""))
    if value == "life":
        return False
    if value == "work":
        return True
    return row.get("source") == "house"


def corrections(rows: list[dict]) -> dict[str, str]:
    out: dict[str, str] = {}
    for row in rows:
        prov = row.get("provenance") or {}
        if row.get("kind") == "expiry":
            target = prov.get("expiry_of")
            if isinstance(target, str) and target and out.get(target) != "retracted":
                out[target] = "expired"
        elif row.get("kind") == "retract":
            target = prov.get("retract_of")
            if isinstance(target, str) and target:
                out[target] = "retracted"
    return out


def keeps(rows: list[dict]) -> dict[str, tuple[str, ...]]:
    found: dict[str, set[str]] = {}
    for row in rows:
        prov = row.get("provenance") or {}
        if row.get("kind") == "pref":
            target = prov.get("pref_of")
            if isinstance(target, str) and target:
                found.setdefault(target, set()).add("pref")
        elif row.get("kind") == "diary":
            for source in prov.get("sources") or []:
                if isinstance(source, str) and source:
                    found.setdefault(source, set()).add("diary")
    from . import decisions
    for lead in decisions.extract(rows, corrections(rows)):
        if lead["status"] == "active":
            found.setdefault(lead["event_id"], set()).add("decision")
    order = ("decision", "pref", "diary")
    return {key: tuple(kind for kind in order if kind in value)
            for key, value in found.items()}


def _age(occurred: object, today: date) -> int | None:
    if isinstance(occurred, datetime):
        return (today - occurred.astimezone(GMT8).date()).days
    try:
        return (today - date.fromisoformat(str(occurred)[:10])).days
    except ValueError:
        return None


def _retain(age: int) -> float:
    return 0.0 if age < 0 else round(math.exp(-age / SHORT_DAYS), 4)


def project(row: dict, today: date, sitting: dict[str, str],
            kept: dict[str, tuple[str, ...]],
            closed: dict[str, str]) -> dict:
    event_id = str((row or {}).get("id") or "")
    age = _age((row or {}).get("occurred_at"), today)
    correction = closed.get(event_id)
    if correction == "retracted":
        return {"event_id": event_id, "phase": "barred", "strength": 0.0,
                "holds": False, "reasons": ["retracted"], "age": age}
    if not speech(row):
        return {"event_id": event_id, "phase": "barred", "strength": 0.0,
                "holds": False, "reasons": ["not-speech"], "age": age}
    reasons = list(kept.get(event_id) or ())
    if work(row, sitting) and not any(k in reasons for k in ("pref", "diary", "kept")):
        return {"event_id": event_id, "phase": "barred", "strength": 0.0,
                "holds": False, "reasons": ["work"], "age": age}
    if reasons:
        trace = {"event_id": event_id, "phase": "stable", "strength": 1.0,
                 "holds": True, "reasons": reasons, "age": age}
    elif age is not None and 0 <= age <= SHORT_DAYS:
        trace = {"event_id": event_id, "phase": "labile", "strength": _retain(age),
                 "holds": True, "reasons": ["week"], "age": age}
    else:
        trace = {"event_id": event_id, "phase": "dormant",
                 "strength": _retain(age) if age is not None else 0.0,
                 "holds": False, "reasons": ["faded"], "age": age}
    if correction == "expired" and trace["phase"] != "barred":
        trace.update(phase="retired", strength=0.0, holds=trace["holds"],
                     reasons=[*trace["reasons"], "expired"])
    return trace


def survey(payloads: list[dict], today: date | None = None) -> dict:
    rows = _rows(payloads)
    day = today or datetime.now(GMT8).date()
    sitting = labels(rows)
    kept = keeps(rows)
    closed = corrections(rows)
    counts = {"barred": 0, "labile": 0, "stable": 0, "dormant": 0, "retired": 0}
    holding = []
    for row in rows:
        if row.get("kind") == "label":
            continue
        trace = project(row, day, sitting, kept, closed)
        counts[trace["phase"]] += 1
        if trace["holds"] and trace["phase"] in ("labile", "stable"):
            holding.append((trace, row))
    holding.sort(key=lambda pair: (
        0 if pair[0]["phase"] == "stable" else 1,
        -pair[0]["strength"],
        -(pair[1].get("seq") or 0),
    ))
    items = [{
        "event_id": trace["event_id"],
        "phase": trace["phase"],
        "strength": trace["strength"],
        "holds": trace["holds"],
        "reasons": trace["reasons"],
        "age": trace["age"],
        "actor": row.get("actor") or "",
        "date": str(row.get("occurred_at") or "")[:10],
        "excerpt": " ".join((row.get("text") or "").split())[:80],
    } for trace, row in holding[:40]]
    return {"today": day.isoformat(), "counts": counts,
            "holding": len(holding),
            "meter": {"unit": "kept_utterance", "count": counts["stable"]},
            "items": items}
