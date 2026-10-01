"""概览页的聚合数据与就绪度探测。

这里存在的理由有两个：

1. /health 挂在应用根路径上，而前端只把 /api 代理给后端，所以界面里根本拿不到它；
   同时它没有覆盖模型就绪度 —— 而这台机器上「对话没反应」最常见的原因就是
   .env 里的模型 id 和服务器上真正加载的模型对不上。
2. 概览原来显示的「今日 token」读的是 user.daily_token_used，
   这个字段全仓库没有任何写入方，于是它永远是 0，却以真实指标的样子摆在首屏。
   概览该讲的是「我能检索到什么、索引到什么程度、系统是否就绪」，
   这些全部可以从已有的表里聚合出来，就是下面这些查询。
"""

import asyncio
from datetime import datetime, timedelta, timezone

import anyio
import httpx
from fastapi import Depends
from pymilvus import MilvusClient
from redis import Redis
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.client import get_milvus_service, get_redis, get_relation_db
from src.config import xinference_addr, xinference_api_key
from src.inference import bindings as inference_bindings
from src.models import (
    Collection,
    Database,
    Document,
    DocumentChunk,
    Tenant,
    TenantMember,
)
from src.user.permissions.service import accessible_database_ids

ACTIVITY_DAYS = 14


def _brief(err: Exception) -> dict:
    """异常 → 读数。类型名足以定位问题，消息原文可能带连接串与主机名。"""
    return {"ok": False, "reason": type(err).__name__}


class SystemService:
    def __init__(self, relation_db: AsyncSession, redis, milvus):
        self.relation_db = relation_db
        self.redis = redis
        self.milvus = milvus

    # ═══ 知识库规模与索引状态 ═══

    async def _knowledge(self, db_ids: set[int] | None):
        """一次把库/集合/文档/分块四级计数与索引状态分布算完。

        db_ids 为 None 表示不限制（管理员）。所有查询都带上同一个范围条件，
        避免出现「卡片说 12 篇、列表里只有 3 篇」这种自相矛盾的首屏。
        """

        def scoped(stmt, column):
            return stmt if db_ids is None else stmt.where(column.in_(db_ids))

        databases_q = scoped(
            select(func.count()).select_from(Database), Database.id
        )
        collections_q = scoped(
            select(func.count()).select_from(Collection), Collection.database_id
        )
        # 文档要经 collection 才能归到 database 上
        documents_q = select(func.count()).select_from(Document).join(
            Collection, Collection.id == Document.collection_id
        )
        if db_ids is not None:
            documents_q = documents_q.where(Collection.database_id.in_(db_ids))

        chunks_q = (
            select(func.count())
            .select_from(DocumentChunk)
            .join(Document, Document.id == DocumentChunk.doc_id)
            .join(Collection, Collection.id == Document.collection_id)
        )
        if db_ids is not None:
            chunks_q = chunks_q.where(Collection.database_id.in_(db_ids))

        # meta 里没有 index_status 的文档是真实存在的（早期数据与纯文本直写），
        # 归到 unknown 而不是悄悄丢掉，否则四个桶加起来对不上文档总数。
        index_status = func.coalesce(
            Document.meta["index_status"].astext, "unknown"
        )
        index_q = (
            select(index_status, func.count())
            .select_from(Document)
            .join(Collection, Collection.id == Document.collection_id)
            .group_by(index_status)
        )
        if db_ids is not None:
            index_q = index_q.where(Collection.database_id.in_(db_ids))

        # 空集合数：这是「为什么检索不到东西」的头号原因，值得单独占一个读数
        empty_q = (
            select(func.count())
            .select_from(Collection)
            .outerjoin(Document, Document.collection_id == Collection.id)
            .where(Document.id.is_(None))
        )
        if db_ids is not None:
            empty_q = empty_q.where(Collection.database_id.in_(db_ids))

        counts = {
            "databases": (
                await self.relation_db.execute(databases_q)
            ).scalar_one()
            or 0,
            "collections": (
                await self.relation_db.execute(collections_q)
            ).scalar_one()
            or 0,
            "documents": (await self.relation_db.execute(documents_q)).scalar_one() or 0,
            "chunks": (await self.relation_db.execute(chunks_q)).scalar_one() or 0,
            "empty_collections": (
                await self.relation_db.execute(empty_q)
            ).scalar_one()
            or 0,
        }
        index = {"indexed": 0, "pending": 0, "failed": 0, "unknown": 0}
        for status, n in (await self.relation_db.execute(index_q)).all():
            key = status if status in index else "unknown"
            index[key] += n or 0
        counts["index"] = index
        return counts

    async def _activity(self, db_ids: set[int] | None):
        """近 ACTIVITY_DAYS 天的入库量（按天补零）+ 最后一次入库时间。

        补零是有意的：让 SQL 只返回有数据的日子，前端画出来的柱状图会在没有活动的
        日期上「没有柱子」，看起来像丢数据而不是没有活动。
        last_ingested_at 是为了窗口为空时界面上仍有一句真话可说：
        这台机器上的文档都比 14 天老，只给一张空图会被读成「系统坏了」。
        """
        since = datetime.now(timezone.utc) - timedelta(days=ACTIVITY_DAYS - 1)
        stmt = (
            select(
                func.date_trunc("day", Document.created_at).label("day"),
                func.count().label("n"),
            )
            .select_from(Document)
            .join(Collection, Collection.id == Document.collection_id)
            .where(Document.created_at >= since)
            .group_by("day")
        )
        if db_ids is not None:
            stmt = stmt.where(Collection.database_id.in_(db_ids))
        rows = {
            day.date().isoformat(): n
            for day, n in (await self.relation_db.execute(stmt)).all()
            if day
        }
        start = since.date()
        series = [
            {
                "date": (start + timedelta(days=i)).isoformat(),
                "documents": rows.get((start + timedelta(days=i)).isoformat(), 0),
            }
            for i in range(ACTIVITY_DAYS)
        ]

        latest_stmt = (
            select(func.max(Document.created_at))
            .select_from(Document)
            .join(Collection, Collection.id == Document.collection_id)
        )
        if db_ids is not None:
            latest_stmt = latest_stmt.where(Collection.database_id.in_(db_ids))
        latest = (await self.relation_db.execute(latest_stmt)).scalar_one_or_none()
        return series, latest.isoformat() if latest else None

    async def _top_collections(self, db_ids: set[int] | None, limit: int = 6):
        """按文档量排序的集合，顺带给出所属库与索引健康度。"""
        stmt = (
            select(
                Collection.id,
                Collection.name,
                Database.id,
                Database.name,
                func.count(Document.id),
                func.count(
                    case(
                        (
                            Document.meta["index_status"].astext == "indexed",
                            Document.id,
                        )
                    )
                ),
                func.count(
                    case(
                        (
                            Document.meta["index_status"].astext == "failed",
                            Document.id,
                        )
                    )
                ),
            )
            .select_from(Collection)
            .join(Database, Database.id == Collection.database_id)
            .outerjoin(Document, Document.collection_id == Collection.id)
            .group_by(Collection.id, Collection.name, Database.id, Database.name)
            .order_by(func.count(Document.id).desc(), Collection.name)
            .limit(limit)
        )
        if db_ids is not None:
            stmt = stmt.where(Collection.database_id.in_(db_ids))
        return [
            {
                "id": cid,
                "name": cname,
                "database_id": db_id,
                "database_name": db_name,
                "document_count": docs,
                "indexed_count": indexed,
                "failed_count": failed,
            }
            for cid, cname, db_id, db_name, docs, indexed, failed in (
                await self.relation_db.execute(stmt)
            ).all()
        ]

    async def _composition(self, db_ids: set[int] | None):
        """租户 → 知识库 → 集合 的三层结构，给概览的关系图用。

        只带计数不带文档正文，尺寸上限就是租户数 + 库数，一次画得完。
        """
        tenants_stmt = select(Tenant.id, Tenant.name, Tenant.database_id)
        members_q = select(
            TenantMember.tenant_id, func.count(TenantMember.user_id)
        ).group_by(TenantMember.tenant_id)
        coll_q = (
            select(Collection.database_id, func.count(Collection.id))
            .group_by(Collection.database_id)
        )
        docs_q = (
            select(Collection.database_id, func.count(Document.id))
            .select_from(Document)
            .join(Collection, Collection.id == Document.collection_id)
            .group_by(Collection.database_id)
        )

        tenants = (await self.relation_db.execute(tenants_stmt)).all()
        member_counts = {r[0]: r[1] for r in (await self.relation_db.execute(members_q)).all()}
        coll_counts = {r[0]: r[1] for r in (await self.relation_db.execute(coll_q)).all()}
        doc_counts = {r[0]: r[1] for r in (await self.relation_db.execute(docs_q)).all()}

        db_stmt = select(Database.id, Database.name).order_by(Database.name)
        if db_ids is not None:
            db_stmt = db_stmt.where(Database.id.in_(db_ids))
        databases = (await self.relation_db.execute(db_stmt)).all()
        by_id = {db_id: {"id": db_id, "name": db_name} for db_id, db_name in databases}

        bound: dict[int | None, list] = {}
        for db_id in by_id:
            owner = next((t for t in tenants if t[2] == db_id), None)
            bound.setdefault(owner[0] if owner else None, []).append(
                {
                    **by_id[db_id],
                    "collection_count": coll_counts.get(db_id, 0),
                    "document_count": doc_counts.get(db_id, 0),
                }
            )

        nodes = []
        for tenant_id, name, _db_id in tenants:
            nodes.append(
                {
                    "kind": "tenant",
                    "id": tenant_id,
                    "name": name,
                    "member_count": member_counts.get(tenant_id, 0),
                    "databases": bound.get(tenant_id, []),
                }
            )
        orphans = bound.get(None, [])
        return {"tenants": nodes, "unbound_databases": orphans}

    # ═══ 依赖服务就绪度 ═══

    def _probe_sync_services(self, detailed: bool):
        """pymilvus / redis 只有同步客户端，放到工作线程里跑，别卡住事件循环。

        detailed=False 时只回异常类型：普通成员不需要看到含主机名/路径的原始报错，
        而根路径那个匿名 /health 恰恰是把这类字符串直接吐给了任何人。
        """
        out = {}
        for key, probe in (("milvus", lambda: self.milvus.list_databases()), ("redis", lambda: self.redis.ping())):
            try:
                probe()
                out[key] = {"ok": True}
            except Exception as e:  # noqa: BLE001 —— 就绪度探测必须把任何异常都降级成一条读数
                out[key] = _brief(e) | ({"detail": f"{type(e).__name__}: {e}"} if detailed else {})
        return out

    async def _services(self, detailed: bool):
        # 只问 redis / milvus；postgres 探测已拆到 _probe_postgres
        return await anyio.to_thread.run_sync(self._probe_sync_services, detailed)

    async def _probe_postgres(self, detailed: bool):
        services = {"postgres": {"ok": True}}
        try:
            await self.relation_db.execute(select(Database.id).limit(1))
        except Exception as e:  # noqa: BLE001
            services["postgres"] = _brief(e) | (
                {"detail": f"{type(e).__name__}: {e}"} if detailed else {}
            )
        return services

    def _resolve_models(self, want: dict) -> dict:
        """按**应用真正使用的那条解析路径**判断模型在不在。

        这里原来只是把 /v1/models 列出来的 model_name 和配置里的 id 比一下。
        那是个假绿发生器：应用取模型用的是 get_model(model_uid=...)，
        而 Xinference 的 uid 和 model_name 是两回事（启动时可以显式指定 uid）。
        于是只要 uid 不等于名字，读数说「已加载」、真实调用却报 Model not found。

        上一版为了修它改成在这里 `RESTfulClient(base_url, api_key=…)` 自己建一个客户端 ——
        那等于又开了第二个事实源，而且**是最糟的一种**：`XINFERENCE_API_KEY` 现在按设计
        是空的（凭据是一把用户级 JWT，由 `auth.set_shared_token` 注进共享句柄），
        所以这个自带客户端不带任何凭据 ⇒ 服务器开鉴权时三个模型全部判成缺失，
        概览写着「模型没加载」而聊天其实是好的。现在走 `get_model_handle`：
        同一个共享句柄、同一份凭据、同一个 401 判定。
        """
        from src.client import get_model_handle

        out = {}
        for role, mid in want.items():
            if not mid:
                out[role] = {"ok": False, "name": "", "reason": "not_bound"}
                continue
            try:
                desc = get_model_handle(mid)
                # 服务器的描述既可能是 dict 也可能带属性：两种都见过，判空不能靠猜
                name = (
                    desc.get("model_name")
                    if isinstance(desc, dict)
                    else getattr(desc, "model_name", None)
                )
                out[role] = {"ok": True, "name": name or mid}
            except Exception as exc:  # noqa: BLE001
                out[role] = {"ok": False, "name": mid, "reason": type(exc).__name__}
        return out

    async def _models(self, detailed: bool):
        """问服务器「配置里这三个模型现在能不能取到」。

        这一步不是可选项：对话没反应最常见的原因就是「系统以为在用」的模型
        与服务器上真正加载的模型对不上，而这在界面上原本完全不可见。

        读的是一份 `bindings`（角色 → model_uid），不再直接读 .env ——
        否则管理台换了绑定、概览却还在按旧配置判就绪，两处各说一套。
        """
        roles = {r["role"]: r for r in inference_bindings.snapshot()["roles"]}
        want = {role: (roles.get(role) or {}).get("model_uid", "") for role in ("llm", "embedding", "rerank")}
        # from_settings 要一路带到界面：还在吃 .env 兜底就说明这台机器没在管理台配过，
        # 那正是「改了 .env 才生效、要重启」的老路，值得提示一下。
        from_settings = [role for role, r in roles.items() if r.get("from_settings")]
        base = (xinference_addr or "").rstrip("/")
        if not base:
            return {
                "endpoint": None,
                "reachable": False,
                "reason": "not_configured",
                "expected": want,
                "missing": list(want),
                "from_settings": from_settings,
                "loaded": [],
            }
        try:
            resolved = await anyio.to_thread.run_sync(self._resolve_models, want)
        except Exception as exc:  # noqa: BLE001
            out = {
                "endpoint": base if detailed else None,
                "reachable": False,
                "reason": type(exc).__name__,
                "expected": want,
                "missing": list(want),
                "from_settings": from_settings,
                "loaded": [],
            }
            if detailed:
                out["detail"] = "%s: %s" % (type(exc).__name__, exc)
            return out

        missing = [role for role, r in resolved.items() if not r["ok"]]
        return {
            "endpoint": base if detailed else None,
            "reachable": True,
            "expected": want,
            "missing": missing,
            "from_settings": from_settings,
            "loaded": [
                {
                    "name": r.get("name"),
                    "type": role,
                    "status": "ready" if r["ok"] else "unavailable",
                    "reason": r.get("reason"),
                }
                for role, r in resolved.items()
            ]
            if detailed
            else [],
        }

    async def overview(self, user_id: int, is_admin: bool):
        db_ids = None if is_admin else await accessible_database_ids(
            self.relation_db, user_id
        )
        # 原始报错文本、模型清单与内部端点只对管理员展开
        detailed = is_admin
        # AsyncSession 不是并发安全的：把五条查询丢进 asyncio.gather 会让它们
        # 在同一个 session 上交错取连接，实测直接抛 IllegalStateChangeError
        # （'_connection_for_bind()  already in progress'）。
        # 所以数据库部分老老实实顺序跑，只并发两个不碰 session 的网络探测
        # （redis/milvus 已经在工作线程里，模型解析是独立 HTTP 调用）。
        knowledge = await self._knowledge(db_ids)
        activity, last_ingested = await self._activity(db_ids)
        top = await self._top_collections(db_ids)
        composition = await self._composition(db_ids)
        postgres = await self._probe_postgres(detailed)
        probed, models = await asyncio.gather(
            self._services(detailed), self._models(detailed)
        )
        services = {**postgres, **probed}
        return {
            # 明确告诉界面这份读数是全站还是仅本人可见范围 —— 否则同一个数字
            # 在管理员和普通用户眼里含义完全不同，界面上却看不出来。
            "scope": "all" if db_ids is None else "granted",
            "knowledge": knowledge,
            "activity": activity,
            "last_ingested_at": last_ingested,
            "top_collections": top,
            "composition": composition,
            "services": services,
            "models": models,
        }


def get_system_service(
    relation_db: AsyncSession = Depends(get_relation_db),
    redis: Redis = Depends(get_redis),
    milvus: MilvusClient = Depends(get_milvus_service),
):
    return SystemService(relation_db=relation_db, redis=redis, milvus=milvus)
