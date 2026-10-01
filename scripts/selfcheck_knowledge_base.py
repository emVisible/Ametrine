#!/usr/bin/env python
"""知识库/向量侧的**进程内**自检（这一轮修的那批 bug 每一条都在这里钉住）。

为什么需要这个文件：交接文档 §2.1 列过一批"已修"的缺陷，但修完没有留下任何会红的门 ——
所以这一轮审计时它们要么已经悄悄回潮、要么根本没人能证明修过。这次的每一条都配一条断言，
并且**每条都有正样本**（能失败的那种），因为本项目已经吃过一次「自写的门永久绿」。

它不动任何真数据：全部用桩件（假 Milvus 客户端、假 embedding 句柄、假 service），
所以可以在没装模型、没起 Milvus 的机器上跑，也不会在库里长出测试垃圾。

用法：
    apps/backend/.venv/bin/python scripts/selfcheck_knowledge_base.py
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "apps" / "backend"))

FAILS: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  {'✓' if ok else '✗'} {label}" + (f"  [{detail}]" if detail else ""))
    if not ok:
        FAILS.append(label)


class FakeMilvus:
    """记录每次调用的假 MilvusClient。`has_collection` 可选择抛异常（非法名字那条路）。"""

    def __init__(self, *, raises: Exception | None = None, exists: bool = True):
        self.calls: list[str] = []
        self.raises = raises
        self.exists = exists

    def use_database(self, db_name: str) -> None:
        self.calls.append(f"use_database:{db_name}")

    def has_collection(self, collection_name: str) -> bool:
        self.calls.append("has_collection")
        if self.raises:
            raise self.raises
        return self.exists

    def load_collection(self, collection_name: str) -> None:
        time.sleep(0.05)          # 模拟真的会花时间的阻塞调用
        self.calls.append("load_collection")

    def search(self, **kw):
        time.sleep(0.05)
        self.calls.append("search")
        return [[{"id": 1, "distance": 0.1, "entity": {"doc_id": "d", "chunk_id": 1}}]]

    def release_collection(self, collection_name: str) -> None:
        self.calls.append("release_collection")

    def delete(self, **kw) -> dict:
        self.calls.append(f"delete:{kw.get('collection_name')}")
        return {"delete_count": 1}

    def flush(self, **kw) -> None:
        self.calls.append("flush")

    def insert(self, **kw) -> dict:
        self.calls.append("insert")
        return {"insert_count": len(kw.get("data") or [])}

    def upsert(self, **kw) -> dict:
        self.calls.append("upsert")
        return {"upsert_count": len(kw.get("data") or [])}


class FakeEmbeddings:
    def embed_query(self, text: str) -> list[float]:
        time.sleep(0.05)
        return [0.1, 0.2]


def doc_service(milvus: FakeMilvus | None = None):
    from src.vector.documents.service import DocumentService

    return DocumentService(
        milvus_service=milvus or FakeMilvus(),
        relation_service=None,
        llm_service=SimpleNamespace(embedding_model=FakeEmbeddings()),
    )


def section(title: str) -> None:
    print(f"\n=== {title} ===")


async def names_gate() -> None:
    from src.utils.names import vector_name_error

    section("1) 名字规则：PG 写得下、向量库建不出的那类名字必须在门口挡掉")
    check("合法名通过", vector_name_error("集合", "bge_m3_2") is None)
    check("带连字符被挡（本机那条 faman-collection 就是它）",
          vector_name_error("集合", "faman-collection") is not None)
    check("数字开头被挡", vector_name_error("集合", "2col") is not None)
    check("中文被挡", vector_name_error("知识库", "薪酬制度") is not None)
    check("空与纯空格都被挡",
          vector_name_error("集合", "") is not None and vector_name_error("集合", "  ") is not None)
    check("两端空格单独说（不是同一句话）",
          "两端" in (vector_name_error("集合", " x ") or ""))
    check("255 通过 / 256 拒绝（边界判据）",
          vector_name_error("集合", "a" * 255) is None
          and vector_name_error("集合", "a" * 256) is not None)


async def create_rollback_gate() -> None:
    from fastapi import HTTPException

    from src.relation.collections import controller as col_ctl
    from src.relation.databases import controller as db_ctl

    section("2) PG 与 Milvus 的同步：一半成功就是脏数据，必须能自己收回去")

    pg = {"deleted": [], "created": []}

    class RelColSvc:
        async def collection_create_service(self, name, database_id, description):
            pg["created"].append(name)
            return {"name": name}

        async def collection_delete_service(self, name):
            pg["deleted"].append(name)

    class VecColSvc:
        def __init__(self, boom):
            self.boom = boom

        async def collection_create_service(self, **kw):
            if self.boom:
                raise RuntimeError("boom from milvus")
            return {}

    class DbLookup:
        async def database_get_by_id_service(self, db_id):
            return "db1"

    # 2a. Milvus 失败 ⇒ PG 那一行必须被删掉。
    #     名字必须合法，否则会被第 0 步的校验挡住，测的就不是回滚了。
    pg["deleted"].clear()
    try:
        await col_ctl.create_collection(
            name="rollback_probe", database_id=1, description="",
            service=RelColSvc(), db_service=DbLookup(),
            vector_collection_service=VecColSvc(boom=True),
        )
        check("Milvus 失败时必须抛错", False, "居然返回成功")
    except HTTPException as e:
        check("Milvus 失败 → 502（不是 500）", e.status_code == 502, str(e.status_code))
        check("失败时 PG 记录被回滚", pg["deleted"] == ["rollback_probe"], str(pg["deleted"]))
        check("回 给客户端的不含上游异常原文",
              "boom from milvus" not in (e.detail or "") and "RuntimeError" in (e.detail or ""))

    # 2b. 非法名字：连 PG 都不该写
    pg["created"].clear()
    try:
        await col_ctl.create_collection(
            name="faman-collection", database_id=1, description="",
            service=RelColSvc(), db_service=DbLookup(),
            vector_collection_service=VecColSvc(boom=False),
        )
        check("非法名字必须被挡在门口", False, "居然建进去了")
    except HTTPException as e:
        check("非法名字 → 422，且 PG 一行都没写",
              e.status_code == 422 and pg["created"] == [], f"{e.status_code} {pg['created']}")

    # 2c. 正常路径不受影响
    ok = await col_ctl.create_collection(
        name="good_name", database_id=1, description="",
        service=RelColSvc(), db_service=DbLookup(),
        vector_collection_service=VecColSvc(boom=False),
    )
    check("合法名字照常创建成功", ok == {"name": "good_name"})

    # 2d. database/delete：向量删不掉时不许先删 PG（否则留下再也看不见的孤儿向量库）
    order: list[str] = []

    class RelDbSvc:
        async def database_delete_service(self, name):
            order.append("pg")

    class VecDbSvc:
        def __init__(self, boom):
            self.boom = boom

        async def database_delete_service(self, db_name):
            order.append("milvus")
            if self.boom:
                raise RuntimeError("nope")

    try:
        await db_ctl.delete(name="x_db", service=RelDbSvc(), vector_db_service=VecDbSvc(boom=True))
        check("向量侧删除失败时必须报错", False, "居然成功")
    except HTTPException as e:
        check("向量删不掉 → 502 且 PG 没被删", e.status_code == 502 and order == ["milvus"],
              str(order))
    order.clear()
    await db_ctl.delete(name="y_db", service=RelDbSvc(), vector_db_service=VecDbSvc(boom=False))
    check("两边都成功时按 向量→PG 的顺序各删一次", order == ["milvus", "pg"], str(order))

    # 2e. database/create 的非法名字
    try:
        await db_ctl.create(name="bad-db-name", description="", tenant_id=None,
                            service=SimpleNamespace(
                                database_create_service=lambda **kw: _raise_never()),
                            vector_db_service=VecDbSvc(boom=False))
        check("非法库名被挡", False, "居然建进去了")
    except HTTPException as e:
        check("非法库名 → 422", e.status_code == 422, str(e.status_code))


def _raise_never():
    raise AssertionError("非法名字不该走到写 PG 那一步")


async def vector_db_create_gate() -> None:
    from fastapi import HTTPException

    from src.vector.databases.service import DatabaseService

    section("3) create_database 的异常分支不许把真正的原因盖掉")
    dropped: list[str] = []

    class M:
        def create_database(self, **kw):
            raise RuntimeError("invalid database name")

        def drop_database(self, db_name):
            dropped.append(db_name)

    svc = DatabaseService(milvus_service=M(), relation_db=None)
    try:
        asyncio.get_event_loop()
        await svc.create_database_service(db_name="bad-db", tenant_name="t")
        check("必须抛出错误", False, "居然成功")
    except HTTPException as e:
        # 旧写法在 except 里去 drop 一个根本没建成的库，那句 drop 自己会抛，
        # 于是原始原因（"invalid database name"）从所有输出里消失。
        check("失败时不去 drop 一个没建成的库", dropped == [], str(dropped))
        check("客户端看到的是类型名，不是上游原文",
              "invalid database name" not in e.detail and "RuntimeError" in e.detail)


async def auth_gate() -> None:
    from src.inference import auth

    section("4) 凭据：推理面也要有人续期，而 401 不许被说成「模型没加载」")
    check("有 ensure_fresh（推理面的续期入口）", callable(getattr(auth, "ensure_fresh", None)))
    check("401 文案判定：status 401", auth.looks_like_auth_rejection("HTTP 401 Unauthorized"))
    check("401 文案判定：Could not validate credentials",
          auth.looks_like_auth_rejection('{"detail":"Could not validate credentials"}'))
    # 正样本：模型真的没加载时绝不能被判成凭据问题，否则又会把人指去「重新登录」
    check("正样本：Model not found 不算凭据问题",
          not auth.looks_like_auth_rejection("Failed to get the model description: Model not found in the model list"))
    check("正样本：连接被拒不算凭据问题",
          not auth.looks_like_auth_rejection("Connection refused"))

    # cluster_authed 不许把一次 502 缓存成「没开鉴权」
    probes = {"n": 0}

    class Resp:
        def __init__(self, code, payload=None):
            self.status_code = code
            self._p = payload or {}

        def json(self):
            return self._p

    import httpx

    real_get = httpx.get

    def fake_get(url, **kw):
        probes["n"] += 1
        return Resp(502, {})

    saved = (auth._authed, auth._token, auth._token_exp, auth._failed_until)
    try:
        auth._authed = None
        httpx.get = fake_get
        first = auth.cluster_authed()
        second = auth.cluster_authed()
        check("非 200 探到「没开鉴权」也不能当答案缓存",
              first is False and probes["n"] == 2, f"probe={probes['n']}")
        check("两次都返回 False（不缓存 False）", second is False)
        httpx.get = lambda url, **kw: Resp(200, {"auth": True})
        auth._authed = None
        check("200 说有鉴权就照实缓存", auth.cluster_authed() is True and auth._authed is True)
    finally:
        httpx.get = real_get
        auth._authed, auth._token, auth._token_exp, auth._failed_until = saved


async def client_handle_gate() -> None:
    from src.client import LazyModelHandle, get_model_handle
    from src.inference.errors import ModelUnavailable, XinferenceUnavailable

    section("5) 取句柄：401 走凭据错误，模型不存在才走 ModelUnavailable")
    import src.client as client_mod

    class Boom401:
        def get_model(self, model_uid):
            raise RuntimeError('Failed to get the model description: {"detail":"Could not validate credentials"}')

    class BoomMissing:
        def get_model(self, model_uid):
            raise RuntimeError("Model not found in the model list")

    class Works:
        def __init__(self):
            self.n = 0

        def get_model(self, model_uid):
            self.n += 1
            if self.n == 1:
                raise RuntimeError("401 Unauthorized")
            return {"model_name": "后一次成功"}

    saved = client_mod.get_client
    try:
        client_mod.get_client = lambda: Boom401()
        try:
            get_model_handle("u")
            check("401 必须抛错", False, "居然成功")
        except XinferenceUnavailable as e:
            check("401 → XinferenceUnavailable（说得出是凭据）", "凭据" in str(e), str(e)[:80])
        except ModelUnavailable as e:
            check("401 不许被翻成模型不可用", False, f"被翻成了 {type(e).__name__}")

        client_mod.get_client = lambda: BoomMissing()
        try:
            LazyModelHandle("the-model").resolve()
            check("模型不存在必须抛错", False, "居然成功")
        except ModelUnavailable as e:
            check("模型不存在 → ModelUnavailable，且带上 uid",
                  "the-model" in str(e) or "the-model" in getattr(e, "model_uid", ""), str(e)[:80])
        except XinferenceUnavailable as e:
            check("正样本：模型不存在不许被说成凭据问题", False, str(e)[:80])

        w = Works()
        client_mod.get_client = lambda: w
        got = get_model_handle("u")
        check("401 之后会重签并重试一次（第二次拿到句柄）",
              got == {"model_name": "后一次成功"} and w.n == 2, f"n={w.n}")
    finally:
        client_mod.get_client = saved


async def retrieval_gate() -> None:
    from src.vector.documents import service as vs

    section("6) 检索：不占事件循环、不每次 release、切库整段互斥")
    check("模块级有那把锁（否则搬线程之后会互相换库）", hasattr(vs, "_milvus_lock"))

    svc = doc_service()
    ticks = {"n": 0, "stop": False}

    async def beat():
        while not ticks["stop"]:
            ticks["n"] += 1
            await asyncio.sleep(0.005)

    b = asyncio.create_task(beat())
    await asyncio.sleep(0.02)
    ticks["n"] = 0
    t0 = time.perf_counter()
    hits = await svc.document_query_service(
        database_name="db1", collection_name="col1", data="问一句", limit=3)
    dt = time.perf_counter() - t0
    ticks["stop"] = True
    await b
    check(f"检索期间事件循环仍在跑（{dt*1000:.0f} ms 里 tick={ticks['n']}）",
          ticks["n"] >= 5, f"tick={ticks['n']}")
    check("仍然返回命中", len(hits) == 1, str(hits))

    m = FakeMilvus()
    svc2 = doc_service(m)
    await svc2.document_query_service(
        database_name="db1", collection_name="col1", data="问一句", limit=3)
    check("不再每次 release 集合（实测那一句值 2 秒）",
          "release_collection" not in m.calls, str(m.calls))
    check("load 保留（幂等、且让 Milvus 重启后自愈）", "load_collection" in m.calls)
    check("切库发生在检索之前且只一次", m.calls[0].startswith("use_database"), str(m.calls))

    # 并发：两路不能互相把库换掉 ⇒ 整段串行，且各自的 hits 都带自己的库名
    order: list[str] = []
    real_use = FakeMilvus.use_database

    class Tracing(FakeMilvus):
        def use_database(self, db_name):
            order.append(db_name)
            real_use(self, db_name)

    svc3 = doc_service(Tracing())

    async def ask(db, text):
        return await svc3.document_query_service(
            database_name=db, collection_name="c", data=text, limit=2)

    r = await asyncio.gather(ask("dbA", "一"), ask("dbB", "二"))
    check("并发两路各自切到自己的库（不串台）",
          {h["database_name"] for h in r[0]} == {"dbA"}
          and {h["database_name"] for h in r[1]} == {"dbB"},
          str([{h['database_name'] for h in x} for x in r]))
    check("两路是串行进入临界区的", order in (["dbA", "dbB"], ["dbB", "dbA"]), str(order))

    # 非法/缺失集合：要给出可行动的错误，不是裸 500
    from fastapi import HTTPException
    from pymilvus.exceptions import MilvusException

    bad = doc_service(FakeMilvus(raises=MilvusException(1100, "Invalid collection name")))
    try:
        await bad.document_query_service(
            database_name="db1", collection_name="faman-collection", data="x", limit=2)
        check("非法集合名必须报错", False, "居然成功")
    except HTTPException as e:
        check("非法集合名 → 409 且说得出这是半条脏记录",
              e.status_code == 409 and "半条" in e.detail, f"{e.status_code} {e.detail[:60]}")
    absent = doc_service(FakeMilvus(exists=False))
    try:
        await absent.document_query_service(
            database_name="db1", collection_name="gone", data="x", limit=2)
        check("集合不存在必须报错", False, "居然成功")
    except HTTPException as e:
        check("集合不存在 → 404", e.status_code == 404, str(e.status_code))


async def reset_gate() -> None:
    from fastapi import HTTPException

    from src.vector.databases import controller as ctl

    section("7) /vector/database/reset：一个 POST 清光全集群，必须显式确认")
    done: list[str] = []

    class Svc:
        async def database_reset_service(self):
            done.append("dropped-everything")
            return "Reset OK"

    try:
        await ctl.reset(confirm="", service=Svc())
        check("空 confirm 绝不能执行", False, "它执行了")
    except HTTPException as e:
        check("空 confirm → 422 且什么都没删",
              e.status_code == 422 and done == [], f"{e.status_code} {done}")
    try:
        await ctl.reset(confirm="yes", service=Svc())
        check("随口一个词也不行（必须是那串原样）", False, "它执行了")
    except HTTPException as e:
        check("错 confirm → 422", e.status_code == 422 and done == [], str(done))
    out = await ctl.reset(confirm="DROP-ALL-VECTOR-DATABASES", service=Svc())
    check("给了正确字样才执行（并如实返回）", out == "Reset OK" and done == ["dropped-everything"])


async def bindings_gate() -> None:
    from src.inference import bindings

    section("8) 绑定快照：TTL 第一次真的被兑现，变化才失效句柄")
    fired: list[int] = []
    probe = lambda: fired.append(1)  # noqa: E731

    saved_snap, saved_loaded, saved_inv = bindings._snapshot, bindings._loaded_at, list(
        bindings._invalidators)
    try:
        bindings._invalidators.append(probe)
        bindings._snapshot = {"llm": "a", "embedding": "b", "rerank": "c"}
        bindings._loaded_at = time.monotonic()

        class Sess:
            pass

        same = await bindings.refresh_if_changed(Sess())
        check("没过期时不去读库", same == {}, str(same))

        bindings._loaded_at = 0.0
        real = bindings.refresh
        calls = {"n": 0}

        async def fake_refresh(session):
            calls["n"] += 1
            return dict(bindings._snapshot)

        bindings.refresh = fake_refresh  # type: ignore[assignment]
        same = await bindings.refresh_if_changed(Sess())
        check("过期则重读一次，值没变就不失效", calls["n"] == 1 and same == {} and fired == [],
              f"calls={calls['n']} fired={fired}")

        async def fake_refresh2(session):
            calls["n"] += 1
            bindings._snapshot = {**bindings._snapshot, "embedding": "new-embed"}
            return dict(bindings._snapshot)

        bindings.refresh = fake_refresh2  # type: ignore[assignment]
        bindings._loaded_at = 0.0
        changed = await bindings.refresh_if_changed(Sess())
        check("真的变了才失效，且返回变化项",
              changed.get("embedding") == "new-embed" and len(fired) == 1,
              f"{changed} fired={fired}")
        bindings.refresh = real  # type: ignore[assignment]
    finally:
        bindings._snapshot, bindings._loaded_at = saved_snap, saved_loaded
        bindings._invalidators[:] = saved_inv

    import main as backend_main

    check("main.py 起了那个定期重读者", callable(getattr(backend_main, "keep_bindings_fresh", None)))


async def existing_gates_still_hold() -> None:
    section("9) 顺带确认真实服务器上的那条脏记录还在（别把「已修」当成「已清」）")
    from sqlalchemy import text

    from src.client import async_session

    async with async_session() as s:
        rows = [(r[0], r[1]) for r in await s.execute(text(
            "select c.name, d.name from collection c join database d on d.id = c.database_id"))]
        dbs = [r[0] for r in await s.execute(text("select name from database"))]
    illegal_col = [n for n, _ in rows if not _ok(n)]
    illegal_db = [n for n in dbs if not _ok(n)]
    print(f"  PG 里 {len(dbs)} 个库 / {len(rows)} 个集合；名字向量库接受不了的："
          f"集合 {illegal_col} 库 {illegal_db}")
    check("这一条不是断言，是提醒：脏数据要用户决定怎么清", True)


def _ok(name: str) -> bool:
    from src.utils.names import vector_name_error

    return vector_name_error("x", name) is None


async def delete_load_gate() -> None:
    """删向量之前必须先把集合装载起来（本机实测：没装载的集合 delete 直接 MilvusException）。

    这条门之所以存在：删除路径原来没有 `load_collection`，而检索路径有 ——
    于是「服务重启之后、没被最近一次检索碰过的知识库删不掉文档」，
    界面还会说「可直接重试」，重试一万次也不会好。
    """
    from uuid import uuid4

    from src.relation.documents import controller as docs_ctl

    m = FakeMilvus()

    class Pg:
        def __init__(self):
            self.deleted = []

        async def document_locate_service(self, document_id):
            return {
                "database_name": "db_a",
                "collection_name": "col_a",
                "document_id": str(document_id),
                "stored_path": None,
            }

        async def document_delete_service(self, document_id, stored_path):
            self.deleted.append(str(document_id))
            return {"deleted": 1}

    class Perm:
        async def require_write_database(self, user_id, database_name):
            return True

    pg = Pg()
    doc_id = uuid4()
    out = await docs_ctl.delete_document(
        doc_id,
        current_user=SimpleNamespace(id=1),
        perm_service=Perm(),
        pg_service=pg,
        milvus=m,
    )
    order = m.calls
    check("删除走完了：向量删了、PG 行也删了（正样本，证明下面那条不是空跑）",
          "delete:col_a" in order and pg.deleted == [str(doc_id)] and out["deleted"] == 1,
          str(order))
    check("load_collection 在 delete 之前，且在切库之后",
          "load_collection" in order
          and order.index("load_collection") > 0
          and order.index("load_collection") < order.index("delete:col_a"),
          str(order))

    # 装载本身失败时不许在这里改口径：让它照原样去 delete，
    # 真失败由删除的 except 如实报出去（否则这里会变成第二种谎）。
    class LoadBoom(FakeMilvus):
        def load_collection(self, collection_name: str) -> None:
            self.calls.append("load_collection:boom")
            raise RuntimeError("装载不上")

    mb = LoadBoom()
    out2 = await docs_ctl.delete_document(
        doc_id,
        current_user=SimpleNamespace(id=1),
        perm_service=Perm(),
        pg_service=Pg(),
        milvus=mb,
    )
    check("装载失败不改变删除的尝试（失败由删除那一侧如实报）",
          "delete:col_a" in mb.calls and out2["deleted"] == 1, str(mb.calls))


async def main() -> int:
    try:
        await names_gate()
        await create_rollback_gate()
        await vector_db_create_gate()
        await auth_gate()
        await client_handle_gate()
        await retrieval_gate()
        await reset_gate()
        await delete_load_gate()
        await bindings_gate()
        await existing_gates_still_hold()
    except Exception as exc:  # noqa: BLE001
        FAILS.append(f"自检自己崩了：{type(exc).__name__}: {exc}")
        import traceback

        traceback.print_exc()
    print()
    if FAILS:
        print(f"✗ {len(FAILS)} 项没过：" + "；".join(FAILS))
        return 1
    print("KB_PASS 全部通过")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
