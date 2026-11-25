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
                        PersonalHouse, Role, Tenant, User)
from src.personal.canonical import GMT8, ZERO, line_hash
from src.personal.service import PersonalService
from src.vector.documents.service import DocumentService
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
        await conn.run_sync(lambda sync_conn: Base.metadata.create_all(sync_conn, checkfirst=False))

    async def override_db():
        async with session() as db:
            yield db

    app.dependency_overrides[get_relation_db] = override_db
    try:
        async with session() as db:
            db.add_all([Role(id=1, name="user"), Role(id=3, name="admin")])
            await db.flush()
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
            chunk = DocumentChunk(content="季度目标是把基础打稳。",
                                  doc_id=document.id, enabled=True)
            db.add(chunk)
            await db.commit()
            db.add(PersonalHouse(tenant_id=one.id, source="test", data={
                "overview": {"counts": {"crystals": 1, "cards": 1,
                                        "people": 1, "ledger_rows": 2,
                                        "speech_rows": 2}},
                "persons": [{"who": "哥哥", "crystals": [], "cards": []}],
                "rooms": [{"id": 1, "topic": "测试房间", "turns": 1,
                           "votes": 0, "agreed": 0, "presence": 1}],
                "crystals": [{"id": 1, "who": "哥哥", "content": "留下"}],
                "cards": [{"id": 1, "who": "哥哥", "summary": "收口"}],
                "discussions": {"1": {"discussion": {"id": 1},
                                      "turns": [], "votes": [],
                                      "presence": []}},
            }))
            await db.commit()
            service = PersonalService(db)
            rows = [_event(1, "今天很好"), _event(2, "明天继续")]
            rows[1]["prev"] = rows[0]["hash"]
            rows[1]["hash"] = line_hash(rows[1])
            await service.append_payloads(one.id, rows)
            ids = user.id, two.id, one.id, knowledge_user.id, admin_user.id
            doc_ids = (document.id, chunk.id)

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport,
                                     base_url="http://test") as client:
            yield client, {"user": ids[0], "fresh": ids[1], "tenant": ids[2],
                           "knowledge_user": ids[3], "admin": ids[4],
                           "document": doc_ids[0], "chunk": doc_ids[1]}
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
    traces = (await client.get("/api/personal/traces", headers=headers)).json()["data"]
    assert any(item["kind"] == "retract" and item["target"] == "ev-000001"
               for item in traces)

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


@pytest.mark.anyio
async def test_admin_can_write_personal_quota(api):
    client, ids = api
    admin_headers = {"Authorization": f"Bearer {_token(ids['admin'])}"}
    denied = await client.patch(
        f"/api/personal/admin/quotas/{ids['user']}",
        headers={"Authorization": f"Bearer {_token(ids['user'])}"},
        json={"daily_token_limit": 10, "monthly_token_limit": 100},
    )
    assert denied.status_code == 403

    saved = await client.patch(
        f"/api/personal/admin/quotas/{ids['user']}", headers=admin_headers,
        json={"daily_token_limit": 0, "monthly_token_limit": 5000},
    )
    assert saved.status_code == 200
    assert saved.json()["data"]["daily_unlimited"] is True

    overview = await client.get("/api/personal/admin/overview", headers=admin_headers)
    row = next(item for item in overview.json()["data"]
               if item["tenant_id"] == ids["tenant"])
    assert row["usage"]["daily_limit"] == 0
    assert row["usage"]["monthly_limit"] == 5000

    wrong = await client.patch(
        f"/api/personal/admin/quotas/{ids['knowledge_user']}",
        headers=admin_headers,
        json={"daily_token_limit": 10, "monthly_token_limit": 100},
    )
    assert wrong.status_code == 422


@pytest.mark.anyio
async def test_vector_search_uses_hits_and_returns_passages(api, monkeypatch):
    client, ids = api
    async def fake_search(self, data, sources, limit=10):
        return [{"doc_id": str(ids["document"]), "chunk_id": ids["chunk"],
                 "relevance_score": 0.5, "score_kind": "rrf",
                 "sources": [{"database_name": "kb", "collection_name": "col"}]}]
    async def fake_milvus():
        return object()
    monkeypatch.setattr("src.client.get_milvus_service", fake_milvus)
    monkeypatch.setattr(DocumentService, "documents_query_multi_service", fake_search)
    response = await client.get(
        "/api/personal/vector-search?q=季度",
        headers={"Authorization": f"Bearer {_token(ids['user'])}"},
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["degraded"] is False
    assert data["documents"][0]["title"] == "季度笔记"
    assert data["documents"][0]["id"].startswith("passage:")


@pytest.mark.anyio
async def test_house_snapshot_is_read_only(api):
    client, ids = api
    headers = {"Authorization": f"Bearer {_token(ids['user'])}"}
    overview = await client.get("/api/personal/house/overview", headers=headers)
    assert overview.status_code == 200
    assert overview.json()["data"]["counts"]["crystals"] == 1
    persons = await client.get("/api/personal/house/persons", headers=headers)
    assert persons.status_code == 200
    assert persons.json()["data"][0]["who"] == "哥哥"
    detail = await client.get("/api/personal/house/discussions/1",
                              headers=headers)
    assert detail.status_code == 200
    assert detail.json()["data"]["discussion"]["id"] == 1

@pytest.mark.anyio
async def test_snapshot_create_list_and_download(api):
    client, ids = api
    headers = {"Authorization": f"Bearer {_token(ids['user'])}"}
    created = await client.post("/api/personal/snapshots", headers=headers)
    assert created.status_code == 200
    body = created.json()["data"]
    assert body["manifest"]["rows"] == 2
    listed = await client.get("/api/personal/snapshots", headers=headers)
    assert listed.status_code == 200
    assert any(item["name"] == body["name"] for item in listed.json()["data"])
    download = await client.get(
        f"/api/personal/snapshots/{body['name']}", headers=headers)
    assert download.status_code == 200
    assert download.content[:2] == b"PK"

@pytest.mark.anyio
async def test_day_and_digest_are_read_only_views(api):
    client, ids = api
    headers = {"Authorization": f"Bearer {_token(ids['user'])}"}
    day = await client.get("/api/personal/day?date=2026-11-22", headers=headers)
    assert day.status_code == 200
    assert day.json()["data"]["total"] == 2
    assert len(day.json()["data"]["segments"]) == 5

    digest = await client.get(
        "/api/personal/digest?level=week&key=2026-W47", headers=headers)
    assert digest.status_code == 200
    assert digest.json()["data"]["count"] == 2
    span = await client.get("/api/personal/digest/span?q=最近", headers=headers)
    assert span.status_code == 200
    assert span.json()["data"]["count"] == 2

@pytest.mark.anyio
async def test_now_and_replay_read_the_same_ledger(api):
    client, ids = api
    headers = {"Authorization": f"Bearer {_token(ids['user'])}"}
    now = await client.get("/api/personal/now", headers=headers)
    assert now.status_code == 200
    assert now.json()["data"]["last_utterance"]["event_id"] == "ev-000002"
    replay = await client.get("/api/personal/replay", headers=headers)
    assert replay.status_code == 200
    assert replay.json()["data"]["verdict"] == "replay_ok"
    assert replay.json()["data"]["rows"] == 2

@pytest.mark.anyio
async def test_rebuild_recomputes_without_writing(api):
    client, ids = api
    headers = {"Authorization": f"Bearer {_token(ids['user'])}"}
    result = await client.post("/api/personal/maintenance/rebuild",
                               headers=headers)
    assert result.status_code == 200
    data = result.json()["data"]
    assert data["ok"] is True
    assert data["rows"] == 2
    assert data["speech"] == 2
    assert data["tail"]
