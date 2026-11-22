from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from src.middleware.tags import ControllerTag
from src.user.auth.service import get_current_user

from .canonical import canonical
from .dto import (
    PersonalLedgerIn,
    PersonalLedgerOut,
    PersonalMemoryOut,
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
