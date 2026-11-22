from __future__ import annotations

from collections.abc import Iterable
from datetime import date, datetime

from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.client import get_relation_db
from src.models import PersonalLedger, Tenant, User

from .canonical import FIELDS, GMT8, ZERO, iso, line_hash, to_gmt8
from .context import compose
from . import periods as period_mod
from .dto import PersonalLedgerIn
from .memory import survey


class PersonalService:
    def __init__(self, relation_db: AsyncSession):
        self.relation_db = relation_db

    async def tenant_id(self, user: User) -> int:
        if not user.tenant_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="当前账号没有绑定租户，个人账本不可用",
            )
        return int(user.tenant_id)

    async def _last(self, tenant_id: int) -> PersonalLedger | None:
        result = await self.relation_db.execute(
            select(PersonalLedger)
            .where(PersonalLedger.tenant_id == tenant_id)
            .order_by(PersonalLedger.seq.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def payloads(self, tenant_id: int, *, limit: int | None = None,
                       before: int | None = None, newest: bool = False,
                       human_only: bool = False) -> list[dict]:
        order = (PersonalLedger.seq.desc() if newest
                 else PersonalLedger.seq.asc())
        query = (select(PersonalLedger)
                 .where(PersonalLedger.tenant_id == tenant_id)
                 .order_by(order))
        if before is not None:
            query = query.where(PersonalLedger.seq < before)
        if human_only:
            query = query.where(PersonalLedger.kind.not_in(
                ("label", "retract", "expiry", "day", "diary", "pref")))
        if limit is not None:
            query = query.limit(limit)
        result = await self.relation_db.execute(query)
        return [row.payload for row in result.scalars().all()]

    async def append(self, tenant_id: int, dto: PersonalLedgerIn) -> dict:
        text = dto.text.strip()
        if not text:
            raise HTTPException(status_code=422, detail="空话不写进账本")
        last = await self._last(tenant_id)
        if last and last.text.strip() == text and last.actor == dto.actor:
            age = (datetime.now(GMT8) - to_gmt8(last.recorded_at)).total_seconds()
            if -5 <= age <= 30:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"与上一条（{last.id}）重复，30 秒内不写第二遍",
                )
        seq = (last.seq + 1) if last else 1
        prev = last.hash if last else ZERO
        occurred = to_gmt8(dto.at) if dto.at else datetime.now(GMT8)
        recorded = datetime.now(GMT8)
        day = occurred.date().isoformat()
        provenance = {
            "origin": "isla/api",
            "session_id": dto.session_id or f"personal-{day}",
            "archive_date": day,
            "live": True,
            **dto.provenance,
        }
        row = {
            "v": 1,
            "seq": seq,
            "id": f"ev-{seq:06d}",
            "occurred_at": iso(occurred),
            "recorded_at": iso(recorded),
            "actor": dto.actor,
            "source": dto.source,
            "kind": dto.kind,
            "text": text,
            "valid_from": iso(occurred),
            "valid_until": None,
            "provenance": provenance,
            "prev": prev,
        }
        row["hash"] = line_hash(row)
        self.relation_db.add(self._model(tenant_id, row))
        await self.relation_db.commit()
        return row

    def _model(self, tenant_id: int, row: dict) -> PersonalLedger:
        return PersonalLedger(
            tenant_id=tenant_id, seq=row["seq"], id=row["id"],
            prev=row["prev"], hash=row["hash"],
            occurred_at=to_gmt8(row["occurred_at"]),
            recorded_at=to_gmt8(row["recorded_at"]),
            actor=row["actor"], source=row["source"], kind=row["kind"],
            text=row["text"], valid_from=to_gmt8(row["valid_from"]),
            valid_until=to_gmt8(row["valid_until"]) if row.get("valid_until") else None,
            provenance=row.get("provenance") or {}, payload=row,
        )

    async def append_payloads(self, tenant_id: int,
                              rows: Iterable[dict]) -> dict:
        """Import rows that already carry seq/prev/hash, never inventing them."""
        batch = list(rows)
        if not batch:
            return {"imported": 0, "tail": None}
        for row in batch:
            missing = [key for key in FIELDS if key not in row]
            if missing:
                raise ValueError(f"{row.get('id', '?')} 缺字段：{missing}")
            if line_hash(row) != row.get("hash"):
                raise ValueError(f"{row.get('id', '?')} 的 hash 与内容不一致")
        first = batch[0]
        last = await self._last(tenant_id)
        expected_seq = (last.seq + 1) if last else 1
        expected_prev = last.hash if last else ZERO
        for row in batch:
            if row["seq"] != expected_seq or row["prev"] != expected_prev:
                raise ValueError(f"{row['id']} 不在链上：期望 seq={expected_seq}")
            expected_seq += 1
            expected_prev = row["hash"]
        self.relation_db.add_all([self._model(tenant_id, row) for row in batch])
        await self.relation_db.commit()
        return {"imported": len(batch), "tail": batch[-1]["hash"],
                "first": first["id"], "last": batch[-1]["id"]}

    async def verify(self, tenant_id: int) -> dict:
        rows = await self.payloads(tenant_id)
        errors: list[str] = []
        prev = ZERO
        for index, row in enumerate(rows, 1):
            if row.get("seq") != index:
                errors.append(f"seq {row.get('seq')} 期望 {index}")
            if row.get("prev") != prev:
                errors.append(f"{row.get('id')} prev 不匹配")
            if line_hash(row) != row.get("hash"):
                errors.append(f"{row.get('id')} hash 不匹配")
            prev = row.get("hash") or ZERO
        return {"verdict": "ledger_ok" if not errors else "BROKEN",
                "rows": len(rows), "tail": prev if rows else None,
                "errors": errors[:20]}

    async def memory(self, tenant_id: int, today: date | None = None) -> dict:
        return survey(await self.payloads(tenant_id), today=today)

    async def search(self, tenant_id: int, query: str, limit: int = 30) -> list[dict]:
        text = query.strip()
        if not text:
            return []
        escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        result = await self.relation_db.execute(
            select(PersonalLedger)
            .where(PersonalLedger.tenant_id == tenant_id,
                   PersonalLedger.kind.not_in(
                       ("label", "retract", "expiry", "day", "diary", "pref")),
                   PersonalLedger.text.ilike(f"%{escaped}%", escape="\\"))
            .order_by(PersonalLedger.occurred_at.desc())
            .limit(limit)
        )
        return [row.payload for row in result.scalars().all()]

    async def _period_rows(self, tenant_id: int) -> list[dict]:
        rows = await self.payloads(tenant_id, human_only=True)
        return [{"id": row["id"], "seq": row["seq"],
                 "occurred_at": to_gmt8(row["occurred_at"]),
                 "actor": row["actor"], "kind": row["kind"],
                 "text": row["text"], "provenance": row.get("provenance") or {}}
                for row in rows]

    async def periods(self, tenant_id: int, level: str) -> list[dict]:
        return period_mod.list_periods(await self._period_rows(tenant_id), level)

    async def period(self, tenant_id: int, level: str, key: str) -> dict | None:
        start, end = period_mod.period_range(key, level)
        rows = await self._period_rows(tenant_id)
        items = period_mod.catalog(rows, start, end)
        if not items:
            return None
        return {"level": level, "period_key": key, "start_date": start,
                "end_date": end, "item_count": len(items),
                "content_digest": period_mod.digest([item["id"] for item in items]),
                "parent_keys": period_mod.parent_keys(key, level),
                "catalog": items, "source_ids": [item["id"] for item in items]}

    async def context_for(self, user: User, today: date | None = None) -> dict:
        """Personal context is automatic; it is not a selectable assistant."""
        if not user.tenant_id:
            return {"prompt": "", "references": [], "event_ids": []}
        tenant = await self.relation_db.get(Tenant, user.tenant_id)
        if tenant is None or tenant.mode != "personal":
            return {"prompt": "", "references": [], "event_ids": []}
        return compose(await self.payloads(tenant.id), today=today)

    async def ensure_tenant(self, name: str, *, mode: str) -> Tenant:
        result = await self.relation_db.execute(
            select(Tenant).where(Tenant.name == name)
        )
        tenant = result.scalar_one_or_none()
        if tenant is None:
            tenant = Tenant(name=name, mode=mode)
            self.relation_db.add(tenant)
        else:
            tenant.mode = mode
        await self.relation_db.commit()
        await self.relation_db.refresh(tenant)
        return tenant


def get_personal_service(
    relation_db: AsyncSession = Depends(get_relation_db),
) -> PersonalService:
    return PersonalService(relation_db=relation_db)
