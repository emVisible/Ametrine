"""Run the ten real referring-expression cases against a tenant ledger.

  .venv/bin/python scripts/check_personal_gold.py --tenant isla
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from sqlalchemy import select

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.client import async_session  # noqa: E402
from src.models import Tenant  # noqa: E402
from src.personal.gold import evaluate  # noqa: E402
from src.personal.service import PersonalService  # noqa: E402


async def run(tenant_name: str) -> dict:
    async with async_session() as db:
        tenant = (await db.execute(
            select(Tenant).where(Tenant.name == tenant_name))).scalar_one_or_none()
        if tenant is None:
            raise SystemExit(f"tenant not found: {tenant_name}")
        return evaluate(await PersonalService(db).payloads(tenant.id))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--tenant", default="isla")
    report = asyncio.run(run(parser.parse_args().tenant))
    for item in report["cases"]:
        print(f"{item['verdict']:4s} {item['case']} {item['event_id']} "
              f"「{item['phrase']}」 -> {','.join(item['resolved'])}")
        for problem in item["problems"]:
            print("      - " + problem)
    print(json.dumps({k: report[k] for k in ("passed", "total", "verdict")},
                     ensure_ascii=False))
    if report["verdict"] != "gold_ok":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
