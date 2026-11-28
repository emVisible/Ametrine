"""Append only the house events that are not already in the ledger.

House and the ledger overlap heavily (231/250 by text). Blind merging would
duplicate them. This script appends the 19 truly missing rows as `note` with
`source=house`, so they are visible in the archive but are NOT speech and do
not enter the memory gate.

  .venv/bin/python scripts/import_house_events.py --tenant isla
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sqlite3
import sys
from pathlib import Path

from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.client import async_session  # noqa: E402
from src.models import Tenant  # noqa: E402
from src.personal.service import PersonalService  # noqa: E402


def _house_events(db_path: Path) -> list[dict]:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(row) for row in conn.execute(
            "select seq, occurred_at, actor, kind, text from events order by seq")]
    finally:
        conn.close()


async def run(args) -> dict:
    events = _house_events(Path(args.db))
    async with async_session() as db:
        tenant = (await db.execute(
            select(Tenant).where(Tenant.name == args.tenant))).scalar_one_or_none()
        if tenant is None:
            raise SystemExit(f"tenant not found: {args.tenant}")
        service = PersonalService(db)
        rows = await service.payloads(tenant.id)
        known = {" ".join((row.get("text") or "").split()) for row in rows}
        added = []
        for event in events:
            text = " ".join((event.get("text") or "").split())
            if not text or text in known:
                continue
            row = await service._append(
                tenant.id, text=event["text"], actor=event.get("actor") or "house",
                kind="note", source="house", at=event.get("occurred_at"),
                session_id="house-import",
                provenance={"origin": "house/truth.db", "house_seq": event["seq"]},
            )
            known.add(text)
            added.append(row["id"])
        verify = await service.verify(tenant.id)
        return {"ok": verify["verdict"] == "ledger_ok", "added": len(added),
                "ids": added, "verify": verify}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="/Users/young/Isla/house/truth.db")
    parser.add_argument("--tenant", default="isla")
    args = parser.parse_args()
    print(json.dumps(asyncio.run(run(args)), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
