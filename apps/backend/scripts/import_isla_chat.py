"""Import old Isla chat turns and the non-secret chat settings.

The provider key in `data/settings.json` is deliberately not read. Only
`chat.actor` and the GMT+8 default are imported; chat generation remains
separate from this migration.

  .venv/bin/python scripts/import_isla_chat.py \
      --db /Users/young/Isla/data/isla.db \
      --settings /Users/young/Isla/data/settings.json \
      --tenant isla --user test@qq.com
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.client import async_session  # noqa: E402
from src.models import Conversation, Message, Tenant, User  # noqa: E402


def _rows(db_path: Path) -> list[dict]:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(row) for row in conn.execute(
            "select id, session_id, role, text, event_id, at "
            "from chat_turns order by id")]
    finally:
        conn.close()


def _stamp(value: str) -> datetime:
    return datetime.fromisoformat(value)


async def run(args) -> dict:
    rows = _rows(Path(args.db))
    if not args.include_test:
        rows = [row for row in rows if not row["session_id"].startswith("s-")]
    async with async_session() as db:
        user = (await db.execute(
            select(User).where(User.name == args.user))).scalar_one_or_none()
        tenant = (await db.execute(
            select(Tenant).where(Tenant.name == args.tenant))).scalar_one_or_none()
        if user is None or tenant is None:
            raise SystemExit("user or tenant not found")
        if user.tenant_id != tenant.id:
            raise SystemExit("user is not bound to this tenant")

        existing = (await db.execute(select(Conversation))).scalars().all()
        imported_sessions = {
            (conversation.meta or {}).get("legacy_session")
            for conversation in existing
        }
        groups: dict[str, list[dict]] = {}
        for row in rows:
            if row["session_id"] in imported_sessions:
                continue
            groups.setdefault(row["session_id"], []).append(row)

        created = 0
        messages = 0
        for session_id, turns in groups.items():
            first_user = next((row for row in turns if row["role"] == "user"), turns[0])
            title = " ".join((first_user.get("text") or "").split())[:40] or "旧会话"
            conversation = Conversation(
                title=title, mode="llm", user_id=user.id,
                created_at=_stamp(turns[0]["at"]),
                updated_at=_stamp(turns[-1]["at"]),
                meta={"legacy_session": session_id,
                      "origin": "isla/chat_turns"},
            )
            db.add(conversation)
            await db.flush()
            for row in turns:
                db.add(Message(
                    conversation_id=conversation.id, role=row["role"],
                    content=row["text"], status="done",
                    created_at=_stamp(row["at"]),
                    meta={"event_id": row.get("event_id"),
                          "origin": "isla/chat_turns"},
                ))
                messages += 1
            created += 1

        actor = None
        settings_path = Path(args.settings)
        if settings_path.is_file():
            data = json.loads(settings_path.read_text(encoding="utf-8"))
            actor = ((data.get("chat") or {}).get("actor") or "").strip() or None
            if actor:
                prefs = dict(user.preferences or {})
                person = dict(prefs.get("personal") or {})
                person.setdefault("actor", actor)
                prefs["personal"] = person
                user.preferences = prefs

        await db.commit()
        return {"ok": True, "conversations": created, "messages": messages,
                "actor": actor, "settings_key_imported": False}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", default="/Users/young/Isla/data/isla.db")
    parser.add_argument("--settings", default="/Users/young/Isla/data/settings.json")
    parser.add_argument("--tenant", default="isla")
    parser.add_argument("--user", default="test@qq.com")
    parser.add_argument("--include-test", action="store_true")
    print(json.dumps(asyncio.run(run(parser.parse_args())),
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
