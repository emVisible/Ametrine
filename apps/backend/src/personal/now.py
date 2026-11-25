from __future__ import annotations

from datetime import datetime

from . import decisions as decision_mod
from .canonical import GMT8, to_gmt8
from .memory import corrections, speech


def _gap(stamp: str | None, now: datetime) -> dict:
    if not stamp:
        return {"days": None, "hours": None, "minutes": None,
                "label": "还没有记录"}
    try:
        moment = to_gmt8(stamp)
    except (ValueError, TypeError):
        return {"days": None, "hours": None, "minutes": None, "label": ""}
    delta = now - moment
    minutes = int(delta.total_seconds() // 60)
    hours = int(delta.total_seconds() // 3600)
    days = delta.days
    if minutes < 2:
        label = "刚刚"
    elif minutes < 60:
        label = f"{minutes} 分钟前"
    elif hours < 24:
        label = f"{hours} 小时前"
    elif days == 1:
        label = "昨天"
    elif days < 30:
        label = f"{days} 天前"
    else:
        label = f"{days // 30} 个月前"
    return {"days": days, "hours": hours, "minutes": minutes,
            "label": label}


def snapshot(rows: list[dict], now: datetime | None = None) -> dict:
    now = now or datetime.now(GMT8)
    said = next((row for row in reversed(rows) if speech(row)), None)
    spoken = {row["id"] for row in rows if speech(row)}
    standing = [lead for lead in decision_mod.extract(rows, corrections(rows))
                if lead["status"] == "active" and lead["event_id"] in spoken][:4]
    return {
        "last_turn": None,
        "last_utterance": ({"event_id": said["id"], "seq": said["seq"],
                            "actor": said["actor"], "kind": said["kind"],
                            "text": said["text"],
                            "at": said["occurred_at"]} if said else None),
        "standing": [{"event_id": lead["event_id"], "actor": lead["actor"],
                      "marker": lead["marker"], "excerpt": lead["excerpt"],
                      "at": lead["at"]} for lead in standing],
        "gap": _gap(said.get("occurred_at") if said else None, now),
        "note": "这些是从账本里取的原样，不是生成的摘要。",
    }
