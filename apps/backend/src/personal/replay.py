from __future__ import annotations

import hashlib
import json
from collections import Counter

ZERO = "0" * 64


def _canon(value) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":")).encode()


def collect(rows: list[dict]) -> dict:
    errors: list[str] = []
    prev = ZERO
    expected = 1
    for row in rows:
        body = {k: v for k, v in row.items() if k != "hash"}
        if row.get("prev") != prev:
            errors.append(f"{row.get('id')}: prev 不匹配")
        if hashlib.sha256(_canon(body)).hexdigest() != row.get("hash"):
            errors.append(f"{row.get('id')}: hash 不重算")
        if row.get("seq") != expected:
            errors.append(f"{row.get('id')}: seq 应为 {expected}")
        if row.get("id") != f"ev-{expected:06d}":
            errors.append(f"{row.get('id')}: id 与 seq 不一致")
        prev = row.get("hash", "")
        expected += 1
    sessions = Counter(str((row.get("provenance") or {}).get("session_id") or "")
                       for row in rows)
    return {
        "rows": len(rows), "head": rows[0].get("hash") if rows else "",
        "tail": prev if rows else "",
        "seq_contiguous": not any("seq" in e for e in errors),
        "ids_contiguous": not any("id 与 seq" in e for e in errors),
        "hash_chain_ok": not any("prev" in e or "hash" in e for e in errors),
        "sessions": len([key for key in sessions if key]),
        "sources": len({str(row.get("source") or "") for row in rows} - {""}),
        "actors": len({str(row.get("actor") or "") for row in rows} - {""}),
        "first_at": rows[0].get("occurred_at") if rows else "",
        "last_at": rows[-1].get("occurred_at") if rows else "",
        "kinds": dict(sorted(Counter(str(row.get("kind") or "")
                                    for row in rows).items())),
        "errors": errors[:20],
        "verdict": "replay_ok" if not errors and rows else "BROKEN",
    }
