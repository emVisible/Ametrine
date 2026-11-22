from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from src.middleware.tags import ControllerTag
from src.user.auth.service import get_current_user

from .canonical import canonical
from .dto import (
    PersonalDecisionOut,
    PersonalKeepIn,
    PersonalLedgerIn,
    PersonalLedgerOut,
    PersonalMemoryOut,
    PersonalPeriodDetailOut,
    PersonalPeriodOut,
    PersonalVerifyOut,
)
from .service import PersonalService, get_personal_service

route_personal = APIRouter(
    prefix="/personal", tags=[ControllerTag.personal],
    dependencies=[Depends(get_current_user)],
)


@route_personal.post("/ledger", response_model=PersonalLedgerOut)
async def ledger_append(
    body: PersonalLedgerIn,
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    row = await service.append(tenant_id, body)
    return row


@route_personal.get("/ledger", response_model=list[PersonalLedgerOut])
async def ledger_list(
    limit: int = Query(100, ge=1, le=1000),
    before: int | None = Query(None, ge=1),
    include_machine: bool = Query(False),
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.payloads(tenant_id, limit=limit, before=before,
                                      newest=True, human_only=not include_machine)


@route_personal.get("/ledger/verify", response_model=PersonalVerifyOut)
async def ledger_verify(
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.verify(tenant_id)


@route_personal.get("/ledger/export")
async def ledger_export(
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    rows = await service.payloads(tenant_id)

    def lines():
        for row in rows:
            yield canonical(row) + b"\n"

    return StreamingResponse(
        lines(), media_type="application/x-ndjson",
        headers={"Content-Disposition": 'attachment; filename="personal-ledger.jsonl"'},
    )


@route_personal.post("/keep")
async def personal_keep(
    body: PersonalKeepIn,
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.keep(tenant_id, body, actor=current_user.name)


@route_personal.get("/decisions", response_model=list[PersonalDecisionOut])
async def personal_decisions(
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.decisions(tenant_id)


@route_personal.get("/search", response_model=list[PersonalLedgerOut])
async def personal_search(
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(30, ge=1, le=100),
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.search(tenant_id, q, limit=limit)


@route_personal.get("/periods", response_model=list[PersonalPeriodOut])
async def personal_periods(
    level: str = Query("week", pattern="^(week|month|quarter|year)$"),
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.periods(tenant_id, level)


@route_personal.get("/periods/{level}/{key}",
                    response_model=PersonalPeriodDetailOut)
async def personal_period(
    level: str,
    key: str,
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    if level not in ("week", "month", "quarter", "year"):
        raise HTTPException(status_code=422, detail="level 只能是 week/month/quarter/year")
    tenant_id = await service.tenant_id(current_user)
    try:
        found = await service.period(tenant_id, level, key)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"周期键不合法：{exc}")
    if found is None:
        raise HTTPException(status_code=404, detail="这一周期没有原话")
    return found


@route_personal.get("/memory", response_model=PersonalMemoryOut)
async def memory_survey(
    today: date | None = Query(None),
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.memory(tenant_id, today=today)


@route_personal.get("/me")
async def personal_me(
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return {"tenant_id": tenant_id, "user_id": current_user.id,
            "name": current_user.name}
