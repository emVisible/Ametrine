from __future__ import annotations

import re
from datetime import datetime, timedelta

from . import aliases as alias_mod
from .canonical import GMT8, iso, to_gmt8
from .memory import speech

DATE_WORDS = {"今天": 0, "今日": 0, "昨天": -1}
PRIOR_WORDS = ("上次", "上一轮", "上回")
EXCERPT = 90
UNREGISTERED = re.compile(
    r"那个[\u4e00-\u9fa5]{0,2}|这个[\u4e00-\u9fa5]{0,2}|那份[\u4e00-\u9fa5]{0,2}"
    r"|那件事|这件事|上面说|前面说|刚才|之前|前几天|咱们|你们|他们|她们"
    r"|老[大一二三四五六七八九十]")
UNREGISTERED_REASON = "没有一手依据登记这个词；宁可答不上来，也不做模糊匹配"


def _excerpt(text: str) -> str:
    flat = " ".join((text or "").split())
    return flat[:EXCERPT] + ("…" if len(flat) > EXCERPT else "")


def _session(row: dict) -> str:
    return str((row.get("provenance") or {}).get("session_id") or "")


def _stamp(row: dict) -> datetime:
    return to_gmt8(str(row.get("occurred_at")))


def _utterances(rows: list[dict], ids: list[str], limit: int = 30) -> list[dict]:
    wanted = set(ids)
    return [{"id": row["id"], "seq": row["seq"],
             "occurred_at": row["occurred_at"], "actor": row["actor"],
             "session_id": _session(row), "excerpt": _excerpt(row.get("text"))}
            for row in sorted((r for r in rows if r.get("id") in wanted),
                              key=lambda r: int(r.get("seq") or 0),
                              reverse=True)[:limit]]


def scan(text: str, vocab: list[str]) -> list[dict]:
    entries = [(word, "date") for word in DATE_WORDS]
    entries += [(word, "prior") for word in PRIOR_WORDS]
    entries += [(word, "person") for word in vocab]
    entries.sort(key=lambda pair: (-len(pair[0]), pair[0]))
    taken = [False] * len(text)
    spans: list[dict] = []
    for word, kind in entries:
        start = 0
        while True:
            index = text.find(word, start)
            if index < 0:
                break
            end = index + len(word)
            if word == "我" and end < len(text) and text[end] == "们":
                start = index + 1
                continue
            if any(taken[index:end]):
                start = index + 1
                continue
            for pos in range(index, end):
                taken[pos] = True
            spans.append({"phrase": word, "kind": kind, "start": index,
                          "end": end, "registered": True})
            start = end
    for match in UNREGISTERED.finditer(text):
        index, end = match.start(), match.end()
        if any(taken[index:end]):
            continue
        for pos in range(index, end):
            taken[pos] = True
        spans.append({"phrase": match.group(), "kind": "unregistered",
                      "start": index, "end": end, "registered": False})
    return sorted(spans, key=lambda span: span["start"])


def _date(rows: list[dict], phrase: str, anchor_day, anchor: dict) -> dict:
    day = anchor_day + timedelta(days=DATE_WORDS[phrase])
    hits = [row for row in rows
            if speech(row) and _stamp(row).date() == day]
    if not hits:
        return {"status": "unresolved", "kind": "date", "phrase": phrase,
                "resolved": [], "labels": [day.isoformat()],
                "utterance_count": 0, "utterances": [],
                "reason": f"指向 {day.isoformat()}，但档案里没有这一天的原话"}
    return {"status": "resolved", "kind": "date", "phrase": phrase,
            "resolved": [f"date:{day.isoformat()}"],
            "labels": [day.isoformat()], "basis": anchor,
            "utterance_count": len(hits),
            "utterances": _utterances(rows, [row["id"] for row in hits]),
            "reason": f"GMT+8 anchor {anchor_day.isoformat()} "
                      f"{'+' if DATE_WORDS[phrase] >= 0 else ''}{DATE_WORDS[phrase]}d"}


def _prior(rows: list[dict], stamp: datetime, session: str | None) -> dict:
    earlier = [row for row in rows
               if speech(row) and _stamp(row) < stamp
               and _session(row) != (session or "")]
    if not earlier:
        return {"status": "unresolved", "kind": "prior", "phrase": "上次",
                "resolved": [], "reason": "没有更早的、别的会话里的原话"}
    row = max(earlier, key=lambda item: (_stamp(item), int(item.get("seq") or 0)))
    return {"status": "resolved", "kind": "prior", "phrase": "上次",
            "resolved": [f"event:{row['id']}"],
            "labels": [f"{row['id']} · {str(row['occurred_at'])[:10]}"],
            "basis": {"at": iso(stamp), "prior_session": _session(row)},
            "utterance_count": 1,
            "utterances": _utterances(rows, [row["id"]]),
            "reason": "最近一条别的会话里的原话"}


def _person(rows: list[dict], found: dict, phrase: str, speaker: str) -> dict:
    hit = alias_mod.resolve_word(found, phrase, speaker)
    if not hit:
        return {"status": "unresolved", "kind": "person", "phrase": phrase,
                "resolved": [], "reason": UNREGISTERED_REASON}
    actors = hit["actors"]
    hits = [row for row in rows if speech(row) and row.get("actor") in actors]
    return {"status": "resolved", "kind": "person", "phrase": phrase,
            "resolved": [f"actor:{actor}" for actor in actors],
            "labels": actors, "basis": hit["basis"],
            "utterance_count": len(hits),
            "utterances": _utterances(rows, [row["id"] for row in hits]),
            "reason": "说话人字段" if hit["kind"] == "speaker_field"
                      else f"从账本登记（{hit['kind']}）"}


def _one(rows: list[dict], found: dict, phrase: str, anchor_day,
         anchor: dict, actor: str, stamp: datetime,
         session: str | None) -> dict:
    if phrase in DATE_WORDS:
        return _date(rows, phrase, anchor_day, anchor)
    if phrase in PRIOR_WORDS:
        return _prior(rows, stamp, session)
    return _person(rows, found, phrase, actor)


def resolve_text(rows: list[dict], text: str, actor: str,
                 at: str | None = None, session: str | None = None) -> dict:
    stamp = to_gmt8(at) if at else datetime.now(GMT8)
    found = alias_mod.extract(rows)
    anchor = {"actor": actor, "occurred_at": iso(stamp), "session_id": session,
              "text": text}
    phrases = []
    for span in scan(text, alias_mod.vocabulary(found)):
        if span["registered"]:
            item = _one(rows, found, span["phrase"], stamp.date(), anchor,
                        actor, stamp, session)
        else:
            item = {"status": "unresolved", "kind": "unregistered",
                    "phrase": span["phrase"], "resolved": [],
                    "utterance_count": 0, "utterances": [],
                    "reason": UNREGISTERED_REASON}
        item["span"] = {"start": span["start"], "end": span["end"]}
        phrases.append(item)
    return {"status": "scanned", "text": text, "anchor": anchor,
            "phrases": phrases,
            "resolved": sum(1 for item in phrases if item["status"] == "resolved"),
            "refused": sum(1 for item in phrases if item["status"] == "unresolved")}


def resolve_event(rows: list[dict], event_id: str, phrase: str | None = None) -> dict:
    row = next((item for item in rows if item.get("id") == event_id), None)
    if row is None:
        return {"status": "unresolved", "reason": f"原话 {event_id} 不在账本里",
                "event_id": event_id}
    found = alias_mod.extract(rows)
    anchor = {"event_id": row["id"], "occurred_at": row["occurred_at"],
              "actor": row["actor"], "session_id": _session(row),
              "excerpt": _excerpt(row.get("text"))}
    stamp = _stamp(row)
    if phrase:
        item = _one(rows, found, phrase, stamp.date(), anchor, row["actor"],
                    stamp, _session(row))
        item["event_id"] = row["id"]
        ok = item["status"] == "resolved"
        return {"status": "resolved" if ok else "unresolved",
                "event_id": row["id"], "text": row["text"], "anchor": anchor,
                "phrases": [item], "resolved": int(ok), "refused": int(not ok)}
    phrases = []
    for span in scan(row["text"], alias_mod.vocabulary(found)):
        if span["registered"]:
            item = _one(rows, found, span["phrase"], stamp.date(), anchor,
                        row["actor"], stamp, _session(row))
        else:
            item = {"status": "unresolved", "kind": "unregistered",
                    "phrase": span["phrase"], "resolved": [],
                    "reason": UNREGISTERED_REASON}
        item["span"] = {"start": span["start"], "end": span["end"]}
        item["event_id"] = row["id"]
        phrases.append(item)
    return {"status": "scanned", "event_id": row["id"], "text": row["text"],
            "anchor": anchor, "phrases": phrases,
            "resolved": sum(1 for item in phrases if item["status"] == "resolved"),
            "refused": sum(1 for item in phrases if item["status"] == "unresolved")}
