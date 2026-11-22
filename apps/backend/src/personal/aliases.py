from __future__ import annotations

import re

CALL_ME = re.compile(r"(?<![你])叫我\s*([\u4e00-\u9fa5A-Za-z]{1,6})")
RANK_SELF = re.compile(r"我(?:是|就是)\s*(老[大一二三四五六七八九十])")
RANK_NAMED = re.compile(
    r"([\u4e00-\u9fa5]{2,4})(?:是|就是)\s*(?:姐姐|妹妹|哥哥|弟弟)?\s*"
    r"(老[大一二三四五六七八九十])")
COLLECTIVE = re.compile(r"我们[两三四五六七八九十\d]个")
WINDOW = 18
HONORIFIC = "(?:姐姐|妹妹|哥哥|弟弟)?"


def _quote(text: str, start: int, end: int) -> str:
    return text[max(0, start - WINDOW): min(len(text), end + WINDOW)] \
        .replace("\n", " ").strip()


def _to_actor(name: str, actors: set[str],
              aliases: dict[str, set[str]]) -> str | None:
    name = name.strip()
    if name in actors:
        return name
    hit = aliases.get(name)
    if hit and len(hit) == 1:
        return next(iter(hit))
    for actor in sorted(actors, key=len, reverse=True):
        if name.startswith(actor) and len(name) <= len(actor) + 3:
            return actor
    return None


def _roster_pattern(actors: set[str], names: set[str]) -> re.Pattern | None:
    known = sorted({n for n in actors if n} | {n for n in names if n},
                   key=len, reverse=True)
    if not known:
        return None
    alt = "(?:" + "|".join(re.escape(n) for n in known) + ")" + HONORIFIC
    return re.compile(rf"{alt}(?:/{alt}){{1,4}}")


def extract(rows: list[dict]) -> dict:
    actors = {row["actor"] for row in rows if row.get("actor")}
    found: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for row in rows:
        text = row.get("text") or ""
        for match in CALL_ME.finditer(text):
            name = match.group(1)
            if name in ("你", "我", "他", "她"):
                continue
            key = (name, row["actor"])
            if key in seen:
                continue
            seen.add(key)
            found.append({"alias": name, "actor": row["actor"], "kind": "call_me",
                          "evidence_event": row["id"],
                          "quote": _quote(text, match.start(), match.end())})

    alias_index: dict[str, set[str]] = {}
    for item in found:
        alias_index.setdefault(item["alias"], set()).add(item["actor"])

    ranks: list[dict] = []
    for row in rows:
        text = row.get("text") or ""
        for match in RANK_SELF.finditer(text):
            key = (match.group(1), row["actor"])
            if key in seen:
                continue
            seen.add(key)
            ranks.append({"alias": match.group(1), "actor": row["actor"],
                          "kind": "rank", "evidence_event": row["id"],
                          "quote": _quote(text, match.start(), match.end())})
        for match in RANK_NAMED.finditer(text):
            name, rank = match.group(1), match.group(2)
            if name in ("我", "你", "他", "她"):
                continue
            actor = _to_actor(name, actors, alias_index)
            if actor is None:
                continue
            key = (rank, actor)
            if key in seen:
                continue
            seen.add(key)
            ranks.append({"alias": rank, "actor": actor, "kind": "rank",
                          "evidence_event": row["id"],
                          "quote": _quote(text, match.start(), match.end())})
    found.extend(ranks)
    for item in ranks:
        alias_index.setdefault(item["alias"], set()).add(item["actor"])

    groups: dict[str, dict] = {}
    roster_re = _roster_pattern(actors, set(alias_index))
    if roster_re is not None:
        for row in rows:
            text = row.get("text") or ""
            colls = list(COLLECTIVE.finditer(text))
            rosters = list(roster_re.finditer(text))
            if not colls or not rosters:
                continue
            pairs = []
            for coll in colls:
                for roster in rosters:
                    gap = (roster.start() - coll.end()
                           if roster.start() >= coll.end()
                           else coll.start() - roster.end())
                    if 0 <= gap <= 30:
                        pairs.append((gap, coll, roster))
            if not pairs:
                continue
            pairs.sort(key=lambda pair: pair[0])
            for _, coll, roster in pairs:
                members = []
                for part in roster.group().split("/"):
                    actor = _to_actor(part, actors, alias_index)
                    if actor is None:
                        members = []
                        break
                    members.append(actor)
                if len(set(members)) < 2:
                    continue
                name = coll.group()
                if name in groups:
                    break
                lo = max(0, min(coll.start(), roster.start()) - 6)
                hi = min(len(text), max(coll.end(), roster.end()) + 6)
                groups[name] = {"name": name,
                                "members": sorted(set(members)),
                                "evidence_event": row["id"],
                                "quote": text[lo:hi].replace("\n", " ").strip()}
                break
    return {"aliases": found, "groups": list(groups.values()),
            "actors": sorted(actors)}


def vocabulary(found: dict) -> list[str]:
    words = set(found["actors"])
    words |= {item["alias"] for item in found["aliases"]}
    words |= {item["name"] for item in found["groups"]}
    words.add("我")
    return sorted(words)


def resolve_word(found: dict, word: str, speaker: str) -> dict | None:
    if word == "我":
        return {"actors": [speaker], "kind": "speaker_field",
                "basis": [{"field": "actor", "value": speaker}]}
    if word in found["actors"]:
        return {"actors": [word], "kind": "actor_name",
                "basis": [{"field": "actor", "value": word}]}
    hits = [item for item in found["aliases"] if item["alias"] == word]
    group = next((item for item in found["groups"] if item["name"] == word), None)
    if hits:
        kinds = {item["kind"] for item in hits}
        return {"actors": sorted({item["actor"] for item in hits}),
                "kind": kinds.pop() if len(kinds) == 1 else "mixed",
                "basis": [{"event_id": item["evidence_event"],
                           "quote": item["quote"], "kind": item["kind"]}
                          for item in hits]}
    if group:
        return {"actors": group["members"], "kind": "group",
                "basis": [{"event_id": group["evidence_event"],
                           "quote": group["quote"]}]}
    return None
