"""Restore a personal snapshot into an empty tenant.

This is deliberately a CLI, not an HTTP write: replacing a ledger over the
network is too easy to do by accident. The ledger is append-only, so restore
refuses a tenant that already has rows.

  .venv/bin/python scripts/restore_personal_snapshot.py \
      --zip /path/personal-1-xxxx.zip --tenant isla --yes
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import sys
import zipfile
from pathlib import Path

from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.client import async_session  # noqa: E402
from src.models import PersonalHouse, Tenant  # noqa: E402
from src.personal.service import PersonalService  # noqa: E402


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def read_snapshot(path: Path) -> tuple[list[dict], dict | None, dict]:
    with zipfile.ZipFile(path) as archive:
        manifest = json.loads(archive.read("MANIFEST.json"))
        if manifest.get("kind") != "ametrine_personal_snapshot":
            raise SystemExit("not a personal snapshot")
        for item in manifest.get("files", []):
            data = archive.read(item["path"])
            if _sha(data) != item["sha256"]:
                raise SystemExit(f"hash mismatch: {item['path']}")
        rows = [json.loads(line) for line in
                archive.read("ledger.jsonl").decode().splitlines() if line.strip()]
        house = (json.loads(archive.read("house.json"))
                 if "house.json" in manifest.get("includes", []) else None)
    return rows, house, manifest


async def run(args) -> dict:
    rows, house, manifest = read_snapshot(Path(args.zip))
    if not args.yes:
        raise SystemExit("refusing without --yes")
    async with async_session() as db:
        tenant = (await db.execute(
            select(Tenant).where(Tenant.name == args.tenant))).scalar_one_or_none()
        if tenant is None:
            raise SystemExit(f"tenant not found: {args.tenant}")
        service = PersonalService(db)
        existing = await service.payloads(tenant.id)
        if existing:
            raise SystemExit(f"tenant {args.tenant} already has {len(existing)} rows; "
                             "restore only into an empty tenant")
        result = await service.append_payloads(tenant.id, rows)
        if house:
            row = (await db.execute(
                select(PersonalHouse).where(PersonalHouse.tenant_id == tenant.id)
            )).scalar_one_or_none()
            if row is None:
                db.add(PersonalHouse(tenant_id=tenant.id, data=house,
                                     source=f"snapshot:{Path(args.zip).name}"))
            else:
                row.data = house
            await db.commit()
        verify = await service.verify(tenant.id)
        return {"tenant_id": tenant.id, "rows": result["imported"],
                "tail": result["tail"], "manifest_rows": manifest.get("rows"),
                "verify": verify}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--zip", required=True)
    parser.add_argument("--tenant", default="isla")
    parser.add_argument("--yes", action="store_true")
    print(json.dumps(asyncio.run(run(parser.parse_args())),
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
