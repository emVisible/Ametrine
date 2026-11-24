from __future__ import annotations

from datetime import datetime
from uuid import uuid4

import httpx
import pytest
from jose import jwt
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from main import app
from src.client import get_relation_db
from src.config import algorithm, postgre_addr, secret_key
from src.models import (Base, Collection, Database, Document, DocumentChunk,
                        Tenant, User)
from src.personal.canonical import GMT8, ZERO, line_hash
from src.personal.service import PersonalService
from src.utils.security import hash


@pytest.fixture
def anyio_backend():
    return "asyncio"


def _event(seq: int, text_value: str, *, kind: str = "ask") -> dict:
    stamp = datetime(2026, 11, 22, 12, tzinfo=GMT8).isoformat(timespec="microseconds")
    row = {
        "v": 1, "seq": seq, "id": f"ev-{seq:06d}",
        "occurred_at": stamp, "recorded_at": stamp, "actor": "哥哥",
        "source": "live", "kind": kind, "text": text_value,
        "valid_from": stamp, "valid_until": None,
        "provenance": {"session_id": "test"}, "prev": ZERO,
    }
    row["hash"] = line_hash(row)
    return row


def _token(user_id: int) -> str:
    return jwt.encode({"sub": str(user_id), "tv": 0}, secret_key,
                      algorithm=algorithm)


@pytest.fixture
async def api(anyio_backend):
    schema = f"test_personal_{uuid4().hex[:8]}"
    base = make_url(postgre_addr)
    admin_engine = create_async_engine(base, poolclass=None)
    test_url = base.set(database=base.database)
    engine = create_async_engine(
        test_url, connect_args={"server_settings": {
            "search_path": f"{schema},public"}},
    )
    session = async_sessionmaker(engine, expire_on_commit=False)
    async with admin_engine.begin() as conn:
        await conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
        await conn.run_sync(Base.metadata.create_all)

    async def override_db():
        async with session() as db:
            yield db

    app.dependency_overrides[get_relation_db] = override_db
    try:
        async with session() as db:
            database = Database(name=f"kb-{uuid4().hex[:6]}")
            db.add(database)
            await db.flush()
            one = Tenant(name=f"personal-{uuid4().hex[:6]}", mode="personal",
                         database_id=database.id)
            knowledge = Tenant(name=f"knowledge-{uuid4().hex[:6]}", mode="knowledge")
            two = User(name=f"no-tenant-{uuid4().hex[:6]}", password=hash("x"),
                       role_id=1, is_active=True, token_version=0)
            db.add_all([one, knowledge, two])
            await db.flush()
            user = User(name=f"user-{uuid4().hex[:6]}", password=hash("x"),
                        role_id=1, is_active=True, token_version=0,
                        tenant_id=one.id)
            knowledge_user = User(name=f"knowledge-user-{uuid4().hex[:6]}",
                                  password=hash("x"), role_id=1,
                                  is_active=True, token_version=0,
                                  tenant_id=knowledge.id)
            admin_user = User(name=f"admin-{uuid4().hex[:6]}", password=hash("x"),
                              role_id=3, is_active=True, token_version=0)
            db.add_all([user, knowledge_user, admin_user])
            await db.commit()
            collection = Collection(name=f"col-{uuid4().hex[:6]}",
                                    database_id=database.id)
            db.add(collection)
            await db.flush()
            document = Document(title="季度笔记", uploader="哥哥",
                                collection_id=collection.id)
            db.add(document)
            await db.flush()
            db.add(DocumentChunk(content="季度目标是把基础打稳。",
                                 doc_id=document.id, enabled=True))
            await db.commit()
            service = PersonalService(db)
            rows = [_event(1, "今天很好"), _event(2, "明天继续")]
            rows[1]["prev"] = rows[0]["hash"]
            rows[1]["hash"] = line_hash(rows[1])
            await service.append_payloads(one.id, rows)
            ids = user.id, two.id, one.id, knowledge_user.id, admin_user.id

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport,
                                     base_url="http://test") as client:
            yield client, {"user": ids[0], "fresh": ids[1], "tenant": ids[2],
                           "knowledge_user": ids[3], "admin": ids[4]}
    finally:
        app.dependency_overrides.pop(get_relation_db, None)
        await engine.dispose()
        async with admin_engine.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        await admin_engine.dispose()


@pytest.mark.anyio
async def test_memory_append_and_retract(api):
    client, ids = api
    headers = {"Authorization": f"Bearer {_token(ids['user'])}"}
    memory = (await client.get("/api/personal/memory?today=2026-11-22",
                               headers=headers)).json()["data"]
    assert memory["counts"]["labile"] == 2

    appended = await client.post("/api/personal/ledger", headers=headers,
                                 json={"text": "新的一句"})
    assert appended.status_code == 200
    event_id = appended.json()["data"]["id"]

    retracted = await client.post("/api/personal/retract", headers=headers,
                                  json={"event_id": "ev-000001",
                                        "reason": "说错了"})
    assert retracted.status_code == 200
    memory = (await client.get("/api/personal/memory?today=2026-11-22",
                               headers=headers)).json()["data"]
    assert memory["counts"]["barred"] >= 2

    one = await client.get(f"/api/personal/ledger/{event_id}", headers=headers)
    assert one.status_code == 200
    assert one.json()["data"]["text"] == "新的一句"


@pytest.mark.anyio
async def test_search_periods_and_settings(api):
    client, ids = api
    headers = {"Authorization": f"Bearer {_token(ids['user'])}"}
    found = await client.get("/api/personal/search?q=很好", headers=headers)
    assert found.status_code == 200
    assert [row["id"] for row in found.json()["data"]] == ["ev-000001"]

    periods = await client.get("/api/personal/periods?level=week", headers=headers)
    assert periods.status_code == 200
    assert periods.json()["data"][-1]["item_count"] == 2

    scope = await client.get("/api/personal/scope-search?q=季度", headers=headers)
    assert scope.status_code == 200
    data = scope.json()["data"]
    assert data["documents"][0]["title"] == "季度笔记"
    assert data["documents"][0]["type"] == "passage"

    saved = await client.patch("/api/personal/settings", headers=headers,
                               json={"actor": "泽航", "timezone": "Asia/Shanghai"})
    assert saved.status_code == 200
    assert saved.json()["data"]["actor"] == "泽航"


@pytest.mark.anyio
async def test_bootstrap_creates_a_personal_tenant(api):
    client, ids = api
    headers = {"Authorization": f"Bearer {_token(ids['fresh'])}"}
    created = await client.post("/api/personal/bootstrap", headers=headers)
    assert created.status_code == 200
    assert created.json()["data"]["created"] is True
    current = await client.get("/api/current", headers=headers)
    assert current.status_code == 200
    assert current.json()["data"]["tenant_mode"] == "personal"


@pytest.mark.anyio
async def test_knowledge_tenant_cannot_read_personal_ledger(api):
    client, ids = api
    headers = {"Authorization": f"Bearer {_token(ids['knowledge_user'])}"}
    response = await client.get("/api/personal/memory", headers=headers)
    assert response.status_code == 403
    assert "个人空间" in response.json()["message"]


@pytest.mark.anyio
async def test_admin_personal_overview_is_gated(api):
    client, ids = api
    forbidden = await client.get(
        "/api/personal/admin/overview",
        headers={"Authorization": f"Bearer {_token(ids['user'])}"},
    )
    assert forbidden.status_code == 403
    allowed = await client.get(
        "/api/personal/admin/overview",
        headers={"Authorization": f"Bearer {_token(ids['admin'])}"},
    )
    assert allowed.status_code == 200
    rows = allowed.json()["data"]
    assert any(row["tenant_id"] == ids["tenant"] for row in rows)
    assert next(row for row in rows if row["tenant_id"] == ids["tenant"])["speech_rows"] == 2
