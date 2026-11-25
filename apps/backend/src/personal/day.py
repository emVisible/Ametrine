from __future__ import annotations

from datetime import date, datetime, timedelta

from .canonical import GMT8, to_gmt8
from .memory import speech

SEGMENTS = [
    {"key": "chen", "label": "清晨留静", "from": 5, "to": 8, "anchor": True},
    {"key": "bai", "label": "白天各做各事", "from": 8, "to": 17.5, "anchor": False},
    {"key": "bang", "label": "傍晚同桌", "from": 17.5, "to": 20, "anchor": True},
    {"key": "ye", "label": "入夜道晚安", "from": 20, "to": 23, "anchor": True},
    {"key": "shou", "label": "深夜守夜", "from": 23, "to": 29, "anchor": False},
]
NOTES = [
    "只读账本与 house 快照；不写日记、不碰私有数据库、不落卡/结晶。",
    "一天从清晨 05:00 到次日 05:00（GMT+8）；深夜守夜是前一天的收束。",
    "五段是节律骨架，不是时刻表；空段就留白。",
]


def _local(value) -> datetime | None:
    try:
        return to_gmt8(str(value))
    except (ValueError, TypeError):
        return None


def day_of(moment: datetime) -> date:
    return (moment - timedelta(days=1)).date() if moment.hour < 5 else moment.date()


def segment_index(moment: datetime) -> int:
    value = moment.hour + moment.minute / 60
    if value < 5:
        value += 24
    for index, segment in enumerate(SEGMENTS):
        if segment["from"] <= value < segment["to"]:
            return index
    return -1


def collect(rows: list[dict], house: dict | None, day_str: str | None = None,
            now: datetime | None = None) -> dict:
    now = now or datetime.now(GMT8)
    spoken = [row for row in rows if speech(row)]
    if day_str:
        day = date.fromisoformat(day_str)
    elif spoken:
        last = _local(spoken[-1]["occurred_at"])
        day = day_of(last) if last else now.date()
    else:
        day = day_of(now)

    start = datetime(day.year, day.month, day.day, 5, 0, tzinfo=GMT8)
    end = start + timedelta(days=1)
    is_today = day == day_of(now)
    current = segment_index(now) if is_today else -1
    buckets: list[list[dict]] = [[] for _ in SEGMENTS]
    total = 0
    for row in spoken:
        moment = _local(row.get("occurred_at"))
        if moment is None or not (start <= moment < end):
            continue
        index = segment_index(moment)
        if index < 0:
            continue
        buckets[index].append({
            "seq": row["seq"], "event_id": row["id"],
            "at": moment.strftime("%H:%M"), "actor": row["actor"],
            "kind": row["kind"], "text": row["text"],
        })
        total += 1

    segments = []
    for index, segment in enumerate(SEGMENTS):
        items = buckets[index]
        segments.append({
            "key": segment["key"], "label": segment["label"],
            "anchor": segment["anchor"], "current": index == current,
            "count": len(items), "items": list(reversed(items[-3:])),
        })

    cards = []
    crystals = []
    for card in (house or {}).get("cards", []):
        born = _local(card.get("born_at"))
        if born and born.date() == day:
            cards.append({"id": card["id"], "who": card["who"],
                          "summary": card.get("summary"),
                          "feeling": card.get("feeling")})
    for crystal in (house or {}).get("crystals", []):
        born = _local(crystal.get("born_at"))
        if born and born.date() == day:
            crystals.append({"id": crystal["id"], "who": crystal["who"],
                             "kind": crystal.get("kind"),
                             "content": crystal.get("content")})

    return {
        "exists": bool(spoken), "read_only": True,
        "private_db_opened": False, "day": day.isoformat(),
        "is_today": is_today,
        "from": start.strftime("%Y-%m-%d %H:%M"),
        "to": end.strftime("%Y-%m-%d %H:%M"),
        "current": SEGMENTS[current]["key"] if current >= 0 else None,
        "total": total, "segments": segments,
        "cards": cards, "crystals": crystals, "notes": NOTES,
    }
