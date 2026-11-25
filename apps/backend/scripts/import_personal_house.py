"""Import Isla's read-only house truth into one tenant snapshot.

Usage:
  .venv/bin/python scripts/import_personal_house.py \
      --db /Users/young/Isla/house/truth.db --tenant isla

House never had HTTP writes. This copies cards, crystals, discussions and
state as a read model; it does not invent write endpoints.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path

from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.client import async_session  # noqa: E402
from src.models import PersonalHouse, Tenant  # noqa: E402
from src.personal.memory import speech  # noqa: E402
from src.personal.service import PersonalService  # noqa: E402


def _rows(conn: sqlite3.Connection, sql: str) -> list[dict]:
    conn.row_factory = sqlite3.Row
    return [dict(row) for row in conn.execute(sql).fetchall()]


def snapshot(db_path: Path) -> dict:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        state = _rows(conn, "select * from state order by who")
        crystals = _rows(conn, "select * from crystals order by id")
        cards = _rows(conn, "select * from cards order by id")
        discussions = _rows(conn, "select * from discussions order by id desc")
        turns = _rows(conn, "select * from turns order by id")
        votes = _rows(conn, "select * from votes order by person")
        presence = _rows(conn, "select * from presence order by discussion_id desc, person")
        events = _rows(conn, "select * from events order by seq")
        event_keys = _rows(conn, "select * from event_keys")
    finally:
        conn.close()

    crystals_by_who: dict[str, list[dict]] = {}
    for row in crystals:
        crystals_by_who.setdefault(row["who"], []).append(row)
    cards_by_who: dict[str, list[dict]] = {}
    for row in cards:
        cards_by_who.setdefault(row["who"], []).append(row)
    topic = {row["id"]: row.get("topic") for row in discussions}

    people = []
    for person in state:
        who = person["who"]
        people.append({
            "who": who, "doing": person.get("doing"),
            "confirmed": person.get("confirmed"), "next": person.get("next"),
            "waiting": person.get("waiting"),
            "updated_at": person.get("updated_at"),
            "crystals": sorted(crystals_by_who.get(who, []),
                               key=lambda row: row["id"], reverse=True),
            "cards": sorted(cards_by_who.get(who, []),
                            key=lambda row: row["id"], reverse=True),
        })

    rooms = []
    for room in discussions:
        room_turns = [row for row in turns if row["discussion_id"] == room["id"]]
        room_votes = [row for row in votes if row["discussion_id"] == room["id"]]
        room_presence = [row for row in presence if row["discussion_id"] == room["id"]]
        rooms.append({**room, "turns": len(room_turns),
                      "votes": len(room_votes),
                      "agreed": sum(1 for row in room_votes if str(row["agree"]) == "1"),
                      "presence": sum(1 for row in room_presence
                                      if str(row["present"]) == "1")})

    details = {}
    for room in discussions:
        detail_turns = [row for row in turns if row["discussion_id"] == room["id"]]
        detail_votes = [row for row in votes if row["discussion_id"] == room["id"]]
        detail_presence = [row for row in presence if row["discussion_id"] == room["id"]]
        details[str(room["id"])] = {"discussion": room, "turns": detail_turns,
                                    "votes": detail_votes,
                                    "presence": detail_presence}

    presence_rows = []
    for row in presence:
        presence_rows.append({**row, "topic": topic.get(row["discussion_id"])})

    counts = {
        "house_events": len(events),
        "crystals": len(crystals), "cards": len(cards),
        "discussions": len(discussions), "people": len(state),
        "presence": len(presence), "event_keys": len(event_keys),
    }
    overview = {
        "counts": counts,
        "latest": [{k: row.get(k) for k in
                    ("seq", "occurred_at", "actor", "kind", "text")}
                   for row in reversed(events[-8:])],
        "people": [{k: person.get(k) for k in
                    ("who", "doing", "next", "waiting", "updated_at")}
                   | {"crystals": len(crystals_by_who.get(person["who"], []))}
                   for person in state],
        "presence": presence_rows,
        "discussions": [{k: row.get(k) for k in
                         ("id", "topic", "status", "started_at", "ended_at",
                          "summary")}
                        for row in discussions[:5]],
        "kinds": [{"kind": kind, "n": n} for kind, n in
                  Counter(row["kind"] for row in events).most_common()],
    }
    return {"overview": overview, "persons": people, "rooms": rooms,
            "crystals": crystals, "cards": cards, "discussions": details}


async def run(args) -> dict:
    data = snapshot(Path(args.db))
    async with async_session() as db:
        tenant = (await db.execute(
            select(Tenant).where(Tenant.name == args.tenant))).scalar_one_or_none()
        if tenant is None:
            raise SystemExit(f"tenant not found: {args.tenant}")
        service = PersonalService(db)
        ledger = await service.payloads(tenant.id)
        data["overview"]["counts"].update({
            "ledger_rows": len(ledger),
            "speech_rows": sum(1 for row in ledger if speech(row)),
        })
        row = (await db.execute(
            select(PersonalHouse).where(PersonalHouse.tenant_id == tenant.id)
        )).scalar_one_or_none()
        if row is None:
            row = PersonalHouse(tenant_id=tenant.id, data=data,
                                source=str(Path(args.db)))
            db.add(row)
        else:
            row.data = data
            row.source = str(Path(args.db))
        await db.commit()
        return {"tenant_id": tenant.id, "source": row.source,
                "counts": data["overview"]["counts"]}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="/Users/young/Isla/house/truth.db")
    parser.add_argument("--tenant", default="isla")
    args = parser.parse_args()
    print(json.dumps(asyncio.run(run(args)), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
