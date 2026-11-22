from __future__ import annotations

from datetime import date

from .memory import survey

MAX_ITEMS = 12
MAX_CHARS = 700


def compose(payloads: list[dict], *, today: date | None = None) -> dict:
    """A small, citable personal block for the same /api/chat turn.

    It is context, not a persona switch. Only what the memory gate currently
    holds is included; barred/work rows never leak into the prompt.
    """
    shelf = survey(payloads, today=today)
    by_id = {row.get("id"): row for row in payloads if row.get("id")}
    lines: list[str] = []
    picked: list[dict] = []
    for item in shelf["items"][:MAX_ITEMS]:
        row = by_id.get(item["event_id"])
        if not row:
            continue
        text = " ".join((row.get("text") or "").split())[:MAX_CHARS]
        lines.append(f"[{item['event_id']}] {item['date']} {item['actor']}：{text}")
        picked.append({"type": "event", "id": item["event_id"],
                       "date": item["date"], "actor": item["actor"],
                       "excerpt": text[:160]})
    if not lines:
        return {"prompt": "", "references": [], "event_ids": []}
    prompt = (
        "以下是账本里这一轮仍成立的原话，只能当证据，不能补写：\n"
        + "\n".join(lines)
        + "\n引用某句原话时用 (ev-xxxxxx)；没有依据就说没有找到。"
    )
    return {"prompt": prompt, "references": picked,
            "event_ids": [item["id"] for item in picked]}
