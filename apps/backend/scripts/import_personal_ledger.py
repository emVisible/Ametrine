"""Import the Isla JSONL ledger into `personal_ledger`.

Run with the Ametrine backend environment:

    cd apps/backend
    uv run python scripts/import_personal_ledger.py \
        --ledger ~/Isla/truth/ledger.jsonl --tenant isla --user admin

The import is chain-checked before a single row is written. Legacy work/life
sentences get append-only `label` rows once, so the new memory gate does not
need the old `_STEER/_CHECKED/_LIFE` constants at runtime.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from src.client import async_session
from src.models import User
from src.personal.canonical import FIELDS, GMT8, ZERO, iso, line_hash
from src.personal.service import PersonalService

# One-time classification of the old archive. Runtime code must not use these.
LEGACY_LIFE = {
    "ev-000147", "ev-000150", "ev-000151", "ev-000153",
    "ev-000192", "ev-000197", "ev-000271",
}
LEGACY_CHECKED = {"ev-000284", "ev-000285", "ev-000295"}
LEGACY_STEER = ("dailyloop", "记忆模块", "检索")


def read_jsonl(path: Path) -> list[dict]:
    rows = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        missing = [key for key in FIELDS if key not in row]
        if missing:
            raise ValueError(f"line {number}: missing {missing}")
        if line_hash(row) != row.get("hash"):
            raise ValueError(f"line {number}: hash mismatch")
        rows.append(row)
    prev = ZERO
    for number, row in enumerate(rows, 1):
        if row["seq"] != number or row["prev"] != prev:
            raise ValueError(f"line {number}: chain broken")
        prev = row["hash"]
    return rows


def label_row(seq: int, prev: str, target: str, sitting: str) -> dict:
    stamp = iso(datetime.now(GMT8))
    row = {
        "v": 1, "seq": seq, "id": f"ev-{seq:06d}",
        "occurred_at": stamp, "recorded_at": stamp,
        "actor": "isla", "source": "isla", "kind": "label",
        "text": f"[label] {target} {sitting}",
        "valid_from": stamp, "valid_until": None,
        "provenance": {"label_of": target, "sitting": sitting,
                       "why": "legacy memory gate", "origin": "isla/import"},
        "prev": prev,
    }
    row["hash"] = line_hash(row)
    return row


def add_labels(rows: list[dict]) -> list[dict]:
    out = list(rows)
    prev = out[-1]["hash"] if out else ZERO
    seq = out[-1]["seq"] if out else 0
    for row in rows:
        text = "".join((row.get("text") or "").lower().split())
        sitting = None
        if row["id"] in LEGACY_LIFE:
            sitting = "life"
        elif row["id"] in LEGACY_CHECKED or any(word in text for word in LEGACY_STEER):
            sitting = "work"
        if sitting:
            seq += 1
            label = label_row(seq, prev, row["id"], sitting)
            out.append(label)
            prev = label["hash"]
    return out


async def run(args) -> dict:
    rows = read_jsonl(Path(args.ledger))
    if args.labels:
        rows = add_labels(rows)
    if args.dry_run:
        return {"ok": True, "dry_run": True, "rows": len(rows),
                "first": rows[0]["id"] if rows else None,
                "last": rows[-1]["id"] if rows else None}
    async with async_session() as session:
        user = None
        if args.user:
            result = await session.execute(
                select(User).where(User.name == args.user))
            user = result.scalar_one_or_none()
            if user is None:
                raise ValueError(f"用户不存在：{args.user}")
        service = PersonalService(relation_db=session)
        tenant = await service.ensure_tenant(
            args.tenant, mode="personal", default_assistant="isla")
        existing = await service.payloads(tenant.id, limit=1)
        if existing:
            return {"ok": False, "tenant_id": tenant.id,
                    "reason": "该租户已有账本；不重复导入"}
        imported = await service.append_payloads(tenant.id, rows)
        if user is not None:
            user.tenant_id = tenant.id
            await session.commit()
        verify = await service.verify(tenant.id)
        return {"ok": verify["verdict"] == "ledger_ok", "tenant_id": tenant.id,
                "imported": imported, "verify": verify}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ledger", required=True)
    parser.add_argument("--tenant", default="isla")
    parser.add_argument("--user", help="bind this username to the tenant")
    parser.add_argument("--no-labels", dest="labels", action="store_false",
                        default=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    try:
        result = asyncio.run(run(args))
    except (OSError, ValueError) as exc:
        result = {"ok": False, "reason": str(exc)}
    print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
