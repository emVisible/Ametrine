from __future__ import annotations

import hashlib
import re

LIMIT = 100
CJK = re.compile(r"[\u4e00-\u9fff]")
LATIN = re.compile(r"[A-Za-z0-9]+")


def count_words(text: str) -> int:
    return len(CJK.findall(text)) + len(LATIN.findall(text))


def _bit(item: dict) -> str:
    labels = item.get("labels") or []
    label = "、".join(labels) or "、".join(item.get("resolved") or [])
    if item.get("status") == "resolved":
        return f"「{item['phrase']}」→{label}"
    if item.get("kind") == "date" and label:
        return f"「{item['phrase']}」指向{label}但没记录"
    return f"「{item['phrase']}」没依据，不猜"


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def compose(resolution: dict, *, event_id: str, entities_before: int,
            entities_after: int, digest_before: str,
            digest_after: str) -> dict:
    phrases = resolution.get("phrases") or []
    resolved = [item for item in phrases if item.get("status") == "resolved"]
    refused = [item for item in phrases if item.get("status") != "resolved"]
    changed = digest_before[:8] != digest_after[:8]
    tail = (f"本体{entities_before}→{entities_after}个实体，"
            f"摘要{'变了' if changed else '没变'}")

    def build(show: list[dict], note: str | None) -> str:
        parts = [f"记住了 {event_id}"]
        if show:
            parts.append("；".join(_bit(item) for item in show))
        if note:
            parts.append(note)
        elif not show and not refused:
            parts.append("这句里没有指代可落")
        parts.append(tail)
        return "。".join(parts) + "。"

    refusal_note = f"{len(refused)}个词没依据" if refused else None
    attempts = [
        (resolved + refused, None),
        (resolved[:3] + refused[:3],
         f"另{len(resolved) + len(refused) - len(resolved[:3]) - len(refused[:3])}个略"
         if len(resolved) + len(refused) > 6 else None),
        (resolved[:2], refusal_note),
        ([], refusal_note),
        ([], None),
    ]
    for show, note in attempts:
        text = build(show, note)
        words = count_words(text)
        if words <= LIMIT:
            return {"text": text, "words": words, "limit": LIMIT,
                    "truncated": (show is not None and len(show) < len(phrases))
                    or note is not None,
                    "digest": _digest(text), "verdict": "brief_ok"}
    text = build([], None)
    return {"text": text, "words": count_words(text), "limit": LIMIT,
            "truncated": True, "digest": _digest(text), "verdict": "brief_ok"}
