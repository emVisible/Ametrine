from __future__ import annotations

import re

SENTENCE = re.compile(r"[。！；\n]")
VERB = re.compile(
    r"决定了|决定用|决定按|决定先|决定不|定下了|定下|敲定|拍板|暂定|就按|"
    r"按这个|改成|改为|采用|改用|先做|先按|以.{0,8}为准|不做了|不用了|"
    r"作废|放弃|取消|只开|默认全关|永不")
LEAD = re.compile(
    r"(?:^|[，,、：:\s])(?:我们|我|你|现在|就|先|已|这次|那就|所以|于是|"
    r"接下来|后面|最终|一致|统一)(?:.{0,12})$")
NOT_A_DECISION = re.compile(
    r"[？?吗呢吧]|如果|假如|要是|可能|应该|也许|或许|会不会|意味着|像是|"
    r"比喻|决定了上面|决定了它|不是|别再|没定|要不要|好不好|哪条|哪一件事")
DIRECTIVE = re.compile(
    r"我(?:现在|这边)?(?:还是)?需要(?:你|有|增|补|加|一|两|同|核|确|把|做|分|她|他)"
    r"|我(?:现在|这边)?要(?:增加|补充|加|把|做|先|用|有|一|两|这|那|分)"
    r"|(?:^|[，。；\s])(?:先|就|那)?把[^，。]{3,24}(?:归到|放|做|改成|挪|删|建|写|落)"
    r"|让(?:宵明|烛徽|艾拉|你)[^，。]{1,12}(?:负责|来做|去|做|接)"
    r"|(?:不要|别)(?:再)?(?:用|给|写|落|按)")
NEAR_BAD = re.compile(
    r"[？?]|吗|如果|要是|假如|也许|或许|会不会|是不是|对吗|好不好|可能")
NARRATORS = {"艾拉"}
MIN_LEN, MAX_LEN = 8, 200


def _third_person(line: str) -> str | None:
    match = VERB.search(line)
    if not match or NOT_A_DECISION.search(line):
        return None
    head = line[:match.start()]
    if head and not LEAD.search(head):
        return None
    return match.group()


def _directive(line: str) -> str | None:
    for hit in DIRECTIVE.finditer(line):
        near = line[max(0, hit.start() - 6): hit.end() + 22]
        if NEAR_BAD.search(near):
            continue
        return hit.group().strip()
    return None


def _marker(line: str, actor: str) -> str | None:
    found = _third_person(line)
    if found:
        return found
    if actor in NARRATORS:
        return None
    return _directive(line)


def extract(rows: list[dict], closed: dict[str, str]) -> list[dict]:
    taken = {key for key, value in closed.items() if value == "retracted"}
    out: list[dict] = []
    for row in rows:
        if row.get("kind") in ("expiry", "day", "diary", "label", "retract"):
            continue
        if row.get("id") in taken:
            continue
        text = str(row.get("text") or "")
        if text.startswith("[expiry]"):
            continue
        for sentence in SENTENCE.split(text):
            line = sentence.strip().strip("*#> 　")
            if not (MIN_LEN <= len(line) <= MAX_LEN):
                continue
            marker = _marker(line, str(row.get("actor") or ""))
            if marker is None:
                continue
            out.append({
                "event_id": row["id"], "seq": int(row.get("seq") or 0),
                "actor": str(row.get("actor") or ""),
                "at": str(row.get("occurred_at") or ""),
                "marker": marker, "excerpt": line,
                "status": "expired" if closed.get(row["id"]) == "expired" else "active",
            })
    out.sort(key=lambda item: (item["seq"], item["event_id"]), reverse=True)
    return out
