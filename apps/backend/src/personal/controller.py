from __future__ import annotations

import json
from pathlib import Path

from datetime import date

from fastapi import (APIRouter, Depends, File, Form, HTTPException, Query,
                     UploadFile)
from fastapi.responses import FileResponse, StreamingResponse

from src.middleware.tags import ControllerTag
from src.user.auth.service import get_admin_user, get_current_user

from .canonical import canonical
from .dto import (
    PersonalActionIn,
    PersonalBulkIn,
    PersonalBulkItem,
    PersonalSettingsIn,
    PersonalDecisionOut,
    PersonalKeepIn,
    PersonalResolveIn,
    PersonalLedgerIn,
    PersonalLedgerOut,
    PersonalMemoryOut,
    PersonalPeriodDetailOut,
    PersonalPeriodOut,
    PersonalQuotaIn,
    PersonalTraceOut,
    PersonalVerifyOut,
)
from .service import PersonalService, get_personal_service

route_personal = APIRouter(
    prefix="/personal", tags=[ControllerTag.personal],
    dependencies=[Depends(get_current_user)],
)


@route_personal.patch("/admin/quotas/{user_id}", dependencies=[Depends(get_admin_user)])
async def personal_admin_quota(
    user_id: int,
    body: PersonalQuotaIn,
    service: PersonalService = Depends(get_personal_service),
):
    return await service.update_quota(user_id, body)


@route_personal.get("/admin/overview", dependencies=[Depends(get_admin_user)])
async def personal_admin_overview(
    service: PersonalService = Depends(get_personal_service),
):
    return await service.admin_overview()


@route_personal.post("/bootstrap")
async def personal_bootstrap(
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    return await service.bootstrap(current_user.id)


@route_personal.get("/settings", response_model=PersonalSettingsIn)
async def personal_settings(
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    return await service.settings(current_user.id)


@route_personal.patch("/settings", response_model=PersonalSettingsIn)
async def personal_settings_update(
    body: PersonalSettingsIn,
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    return await service.update_settings(current_user.id, body)


@route_personal.post("/bulk")
async def personal_bulk(
    body: PersonalBulkIn,
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    actor = await service.actor_name(current_user)
    return await service.bulk(tenant_id, body, actor=actor)


@route_personal.get("/jobs")
async def personal_jobs(
    limit: int = Query(50, ge=1, le=200),
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.jobs(tenant_id, limit=limit)


@route_personal.post("/ingest")
async def personal_ingest(
    file: UploadFile = File(...),
    source: str = Form("ingest"),
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in (".jsonl", ".ndjson", ".txt", ".md"):
        raise HTTPException(status_code=415,
                            detail="只支持 .jsonl/.ndjson/.txt/.md")
    raw = await file.read()
    if len(raw) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="导入文件不能超过 5 MB")
    items = []
    for number, line in enumerate(raw.decode("utf-8", errors="replace").splitlines(), 1):
        text = line.strip()
        if not text or text.startswith("#"):
            continue
        if suffix in (".txt", ".md"):
            items.append(PersonalBulkItem(text=text))
            continue
        try:
            value = json.loads(text)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=422,
                                detail=f"第 {number} 行不是 JSON：{exc}")
        if isinstance(value, str):
            items.append(PersonalBulkItem(text=value))
        elif isinstance(value, dict):
            if "hash" in value or "seq" in value:
                raise HTTPException(status_code=422,
                                    detail=f"第 {number} 行像账本行，拒绝导入")
            if value.get("kind") in ("retract", "expiry", "label", "day", "diary"):
                raise HTTPException(status_code=422,
                                    detail=f"第 {number} 行是机器留痕，拒绝导入")
            items.append(PersonalBulkItem(**value))
        else:
            raise HTTPException(status_code=422,
                                detail=f"第 {number} 行不是字符串或对象")
    if not items:
        raise HTTPException(status_code=422, detail="文件里没有可导入的行")
    body = PersonalBulkIn(items=items, source=source)
    actor = await service.actor_name(current_user)
    tenant_id = await service.tenant_id(current_user)
    return await service.bulk(tenant_id, body, actor=actor, kind="ingest")


@route_personal.post("/utterances")
async def personal_utterance(
    body: PersonalLedgerIn,
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    body.actor = body.actor or await service.actor_name(current_user)
    return await service.utterance(tenant_id, body, actor=body.actor)


@route_personal.post("/ledger", response_model=PersonalLedgerOut)
async def ledger_append(
    body: PersonalLedgerIn,
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    body.actor = body.actor or await service.actor_name(current_user)
    row = await service.append(tenant_id, body)
    return row


@route_personal.get("/archive")
async def personal_archive(
    q: str = Query("", max_length=200),
    actor: str = Query("", max_length=64),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.archive(tenant_id, q=q, actor=actor,
                                 limit=limit, offset=offset)


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
    return await service.keep(tenant_id, body,
                              actor=await service.actor_name(current_user))


@route_personal.post("/retract")
async def personal_retract(
    body: PersonalActionIn,
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.retract(tenant_id, body,
                                 actor=await service.actor_name(current_user))


@route_personal.post("/expire")
async def personal_expire(
    body: PersonalActionIn,
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.expire(tenant_id, body,
                                actor=await service.actor_name(current_user))


@route_personal.get("/ontology")
async def personal_ontology(
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.ontology(tenant_id)


@route_personal.get("/aliases")
async def personal_aliases(
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.aliases(tenant_id)


@route_personal.post("/resolve")
async def personal_resolve(
    body: PersonalResolveIn,
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.resolve(tenant_id, body)


@route_personal.get("/decisions", response_model=list[PersonalDecisionOut])
async def personal_decisions(
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.decisions(tenant_id)


@route_personal.get("/ledger/{event_id}", response_model=PersonalLedgerOut)
async def ledger_one(
    event_id: str,
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    row = await service.by_id(tenant_id, event_id)
    if row is None:
        raise HTTPException(status_code=404, detail="这句原话不在账本里")
    return row


@route_personal.post("/snapshots")
async def personal_snapshot_create(
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.create_snapshot(tenant_id)


@route_personal.get("/snapshots")
async def personal_snapshot_list(
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.snapshots(tenant_id)


@route_personal.get("/snapshots/{name}")
async def personal_snapshot_download(
    name: str,
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    path = service.snapshot_path(tenant_id, name)
    if path is None:
        raise HTTPException(status_code=404, detail="快照不存在")
    return FileResponse(path, media_type="application/zip", filename=name)


@route_personal.post("/maintenance/rebuild")
async def personal_rebuild(
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.rebuild(tenant_id)


@route_personal.get("/now")
async def personal_now(
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.now(tenant_id)


@route_personal.get("/replay")
async def personal_replay(
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.replay(tenant_id)


@route_personal.get("/day")
async def personal_day(
    date_str: str | None = Query(None, alias="date",
                                 pattern=r"^\d{4}-\d{2}-\d{2}$"),
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    try:
        return await service.day(tenant_id, date_str)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"日期不合法：{exc}")


@route_personal.get("/digest")
async def personal_digest(
    level: str = Query("week", pattern="^(week|month|quarter|year)$"),
    key: str = Query(..., min_length=4, max_length=16),
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    try:
        return await service.digest(tenant_id, level, key)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"周期键不合法：{exc}")


@route_personal.get("/digest/span")
async def personal_digest_span(
    q: str = Query(..., min_length=1, max_length=80),
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    found = await service.digest_span(tenant_id, q)
    if found is None:
        raise HTTPException(status_code=422, detail="这句话里没有可识别的时间范围")
    return found


@route_personal.get("/house/events")
async def personal_house_events(
    q: str = Query("", max_length=200),
    actor: str = Query("", max_length=64),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.house_events(tenant_id, q=q, actor=actor,
                                      limit=limit, offset=offset)


@route_personal.get("/house/overview")
async def personal_house_overview(
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    data = await service.house(tenant_id)
    if data is None:
        raise HTTPException(status_code=404, detail="还没有导入 house 数据")
    return data["overview"]


@route_personal.get("/house/persons")
async def personal_house_persons(
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    data = await service.house(tenant_id)
    if data is None:
        raise HTTPException(status_code=404, detail="还没有导入 house 数据")
    return data["persons"]


@route_personal.get("/house/rooms")
async def personal_house_rooms(
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    data = await service.house(tenant_id)
    if data is None:
        raise HTTPException(status_code=404, detail="还没有导入 house 数据")
    return data["rooms"]


@route_personal.get("/house/crystals")
async def personal_house_crystals(
    who: str | None = Query(None, max_length=40),
    limit: int = Query(50, ge=1, le=200),
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    data = await service.house(tenant_id)
    if data is None:
        raise HTTPException(status_code=404, detail="还没有导入 house 数据")
    items = [row for row in data["crystals"] if not who or row["who"] == who]
    return list(reversed(items))[:limit]


@route_personal.get("/house/cards")
async def personal_house_cards(
    limit: int = Query(50, ge=1, le=200),
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    data = await service.house(tenant_id)
    if data is None:
        raise HTTPException(status_code=404, detail="还没有导入 house 数据")
    return list(reversed(data["cards"]))[:limit]


@route_personal.get("/house/discussions/{discussion_id}")
async def personal_house_discussion(
    discussion_id: int,
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    data = await service.house(tenant_id)
    if data is None:
        raise HTTPException(status_code=404, detail="还没有导入 house 数据")
    row = data["discussions"].get(str(discussion_id))
    if row is None:
        raise HTTPException(status_code=404, detail="discussion not found")
    return row


@route_personal.get("/audit")
async def personal_audit(
    limit: int = Query(100, ge=1, le=500),
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.audit(tenant_id, limit=limit)


@route_personal.get("/traces", response_model=list[PersonalTraceOut])
async def personal_traces(
    limit: int = Query(100, ge=1, le=500),
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    return await service.traces(tenant_id, limit=limit)


@route_personal.get("/vector-search")
async def personal_vector_search(
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(20, ge=1, le=100),
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    await service.tenant_id(current_user)
    return await service.vector_search(current_user.id, q, limit=limit)


@route_personal.get("/scope-search")
async def personal_scope_search(
    q: str = Query(..., min_length=1, max_length=200),
    limit: int = Query(20, ge=1, le=100),
    current_user=Depends(get_current_user),
    service: PersonalService = Depends(get_personal_service),
):
    tenant_id = await service.tenant_id(current_user)
    personal = await service.search(tenant_id, q, limit=limit)
    documents = await service.document_search(current_user.id, q, limit=limit)
    return {"personal": personal, "documents": documents}


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
