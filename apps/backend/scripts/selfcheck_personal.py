"""Read-only check of one personal tenant: chain, rows, memory counts."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from src.client import async_session  # noqa: E402
from src.models import Tenant  # noqa: E402
from src.personal.service import PersonalService  # noqa: E402


async def run(name: str) -> dict:
    async with async_session() as session:
        result = await session.execute(select(Tenant).where(Tenant.name == name))
        tenant = result.scalar_one_or_none()
        if tenant is None:
            return {"ok": False, "reason": f"租户不存在：{name}"}
        service = PersonalService(relation_db=session)
        verify = await service.verify(tenant.id)
        memory = await service.memory(tenant.id)
        return {"ok": verify["verdict"] == "ledger_ok", "tenant_id": tenant.id,
                "mode": tenant.mode, "assistant": tenant.default_assistant,
                "verify": verify,
                "memory": {key: memory[key]
                           for key in ("today", "counts", "holding", "meter")}}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tenant", default="isla")
    args = parser.parse_args(argv)
    out = asyncio.run(run(args.tenant))
    print(json.dumps(out, ensure_ascii=False, indent=2, default=str))
    return 0 if out.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
