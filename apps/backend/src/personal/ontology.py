from __future__ import annotations

import hashlib
import json
import re

from .memory import speech

EXPLICIT = {
    "v": 1,
    "entity_types": ["actor", "channel", "session", "date", "kind", "term"],
    "relation_types": ["mentions"],
    "state_keys": ["count", "last_seen"],
    "markers": "backtick_or_corner_brackets",
    "mention_regex": r"`([^`\n]{1,60})`|「([^」\n]{1,30})」",
    "aliases": {},
}
MARKER = re.compile(EXPLICIT["mention_regex"])
KINDS = (
    ("actor", lambda row, prov: row["actor"]),
    ("channel", lambda row, prov: row["source"]),
    ("session", lambda row, prov: prov.get("session_id")),
    ("date", lambda row, prov: prov.get("archive_date")),
    ("kind", lambda row, prov: row["kind"]),
)


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":")).encode()


def digest_of(graph: dict) -> str:
    body = {key: graph[key] for key in
            ("v", "schema", "built_from", "entities", "relations", "states",
             "counts")}
    return hashlib.sha256(canonical(body)).hexdigest()


def build(rows: list[dict]) -> dict:
    """The same graph as Isla, computed from payloads instead of SQL tables."""
    speech_rows = [row for row in rows if speech(row)]
    by_id = {row["id"]: row for row in speech_rows}
    groups: dict[str, dict[str, list[str]]] = {
        key: {} for key in ("actor", "channel", "session", "date", "kind", "term")}
    mentions: dict[str, list[tuple[str, int, int]]] = {}
    for row in speech_rows:
        prov = row.get("provenance") or {}
        for kind, getter in KINDS:
            value = getter(row, prov)
            if value is None or str(value) == "":
                continue
            groups[kind].setdefault(str(value), []).append(row["id"])
        hits: dict[str, dict] = {}
        for match in MARKER.finditer(row.get("text") or ""):
            term = (match.group(1) or match.group(2)).strip()
            if not term:
                continue
            hit = hits.setdefault(term, {"count": 0, "offset": match.start()})
            hit["count"] += 1
            groups["term"].setdefault(term, []).append(row["id"])
        mentions[row["id"]] = [(term, hit["count"], hit["offset"])
                               for term, hit in hits.items()]

    def evidence(ids):
        return list(dict.fromkeys(ids))

    def times(ids):
        return [by_id[event_id]["occurred_at"] for event_id in ids]

    entities = []
    for kind in ("actor", "channel", "session", "date", "kind", "term"):
        for key, raw_ids in groups[kind].items():
            ids = evidence(raw_ids)
            entities.append({
                "id": f"{kind}:{key}", "type": kind, "label": key,
                "first_seen": min(times(ids)), "last_seen": max(times(ids)),
                "evidence": ids, "source": by_id[ids[-1]].get("source") or "",
            })
    # A name can be real without a speech row: keep it addressable, evidence empty.
    known_actors = set(groups["actor"])
    for row in rows:
        key = str(row.get("actor") or "")
        if not key or key in known_actors:
            continue
        known_actors.add(key)
        stamp = row.get("occurred_at")
        entities.append({"id": f"actor:{key}", "type": "actor", "label": key,
                         "first_seen": stamp, "last_seen": stamp,
                         "evidence": [], "source": row.get("source") or ""})

    relations = []
    for row in speech_rows:
        for term, count, offset in mentions[row["id"]]:
            relations.append({
                "src": f"event:{row['id']}", "dst": f"term:{term}",
                "type": "mentions", "count": count, "offset": offset,
                "occurred_at": row["occurred_at"],
                "evidence": [row["id"]],
            })

    states = []
    for kind in ("actor", "channel", "session", "date", "kind", "term"):
        for key, raw_ids in groups[kind].items():
            ids = evidence(raw_ids)
            if not ids:
                continue
            latest = max(times(ids))
            last = by_id[ids[-1]]
            for state_key, value in (("count", len(ids)), ("last_seen", latest)):
                states.append({
                    "subject": f"{kind}:{key}", "key": state_key, "value": value,
                    "as_of": latest, "source": last.get("source") or "",
                    "evidence": [ids[-1]],
                })

    graph = {
        "v": 1, "schema": EXPLICIT,
        "built_from": {"origin": "personal_ledger", "rows": len(rows),
                       "speech": len(speech_rows),
                       "ledger_tail": speech_rows[-1]["hash"] if speech_rows else ""},
        "entities": entities, "relations": relations, "states": states,
        "counts": {"entities": len(entities), "relations": len(relations),
                   "states": len(states), "events": len(speech_rows)},
    }
    graph["content_digest"] = digest_of(graph)
    return graph
