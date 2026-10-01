from fastapi import Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from src.client import get_relation_db
from src.models import (
    Collection,
    Database,
    Tenant,
    TenantMember,
    User,
    UserDatabasePermission,
)
from ..databases.service import DatabaseService, get_database_service
from src.user.quota import is_unlimited, usage_by_user


class TenantService:
    def __init__(self, relation_db: AsyncSession, database_service: DatabaseService):
        self.relation_db = relation_db
        self.database = database_service

    async def get_all_tenants(self):
        # 原来每个租户再查一次 Database 拿名字：租户数一多就是 N+1。
        # tenant.database_id 是外键，直接 join 一次取完。
        result = await self.relation_db.execute(
            select(Tenant.id, Tenant.name, Tenant.database_id, Database.name)
            .outerjoin(Database, Database.id == Tenant.database_id)
            .order_by(Tenant.name)
        )
        counts = await self._member_counts()
        return [
            {
                "id": tenant_id,
                "name": name,
                "database": database_name,
                "member_count": counts.get(tenant_id, 0),
            }
            for tenant_id, name, _db_id, database_name in result.all()
        ]

    async def _member_counts(self) -> dict[int, int]:
        result = await self.relation_db.execute(
            select(TenantMember.tenant_id, func.count())
            .group_by(TenantMember.tenant_id)
        )
        return {row[0]: row[1] for row in result.all()}

    async def get_overview(self):
        """一次请求摊平「租户 × 成员 × 知识库 × 授权」四张表。

        管理台原来的调用形状是：列租户 1 次 + 每展开一个租户再要 1 次成员 +
        每个用户的知识库授权又要 1 次 —— 折叠面板需要同时看到这些数字，
        于是首屏就是 1+N+M 次往返。这里换成固定 7 条分组查询，与数据量无关。
        """
        tenants_rows = await self.relation_db.execute(
            select(Tenant.id, Tenant.name, Tenant.database_id, Database.name)
            .outerjoin(Database, Database.id == Tenant.database_id)
            .order_by(Tenant.name)
        )
        members_rows = await self.relation_db.execute(
            select(
                TenantMember.tenant_id,
                TenantMember.user_id,
                TenantMember.role,
                TenantMember.created_at,
                User.name,
            )
            .join(User, User.id == TenantMember.user_id)
            .order_by(User.name)
        )
        collections_rows = await self.relation_db.execute(
            select(Collection.database_id, func.count(Collection.id)).group_by(
                Collection.database_id
            )
        )
        databases_rows = await self.relation_db.execute(
            select(Database.id, Database.name, Database.description, Database.is_active)
            .order_by(Database.name)
        )
        grants_rows = await self.relation_db.execute(
            select(
                UserDatabasePermission.user_id,
                UserDatabasePermission.database_id,
                UserDatabasePermission.can_read,
                UserDatabasePermission.can_write,
                UserDatabasePermission.can_manage,
                Database.name,
            )
            .outerjoin(Database, Database.id == UserDatabasePermission.database_id)
            .order_by(UserDatabasePermission.user_id)
        )
        users_rows = await self.relation_db.execute(
            select(
                User.id,
                User.name,
                User.role_id,
                User.is_active,
                User.email,
                User.tenant_id,
                User.last_login_at,
                User.daily_token_limit,
                User.monthly_token_limit,
            ).order_by(User.name)
        )
        # 用量三列原来直接从 `user.*_token_used` 里读，而全仓没有任何地方写它们 ——
        # 于是管理员看到的用量对每个人都恰好是 0，而 `/api/current` 那边是现算的真值。
        # 现在两边共用同一份聚合口径，且整张表只发两条查询（不是每人一条）。
        daily_usage = await usage_by_user(self.relation_db, "day")
        monthly_usage = await usage_by_user(self.relation_db, "month")
        total_usage = await usage_by_user(self.relation_db, "all")

        collection_counts: dict[int, int] = {
            db_id: n for db_id, n in collections_rows.all() if db_id is not None
        }

        # 租户归属可能同时来自 TenantMember（多对多）和 legacy 的 user.tenant_id，
        # 两套记录在旧版界面里各显示一半，这里合并成一个成员集合再输出。
        members_by_tenant: dict[int, dict[int, dict]] = {}
        for tenant_id, user_id, role, created_at, name in members_rows.all():
            members_by_tenant.setdefault(tenant_id, {})[user_id] = {
                "user_id": user_id,
                "name": name,
                "role": role or "member",
                "joined_at": created_at.isoformat() if created_at else None,
                "source": "member",
            }
        legacy_rows = await self.relation_db.execute(
            select(User.tenant_id, User.id, User.name).where(
                User.tenant_id.is_not(None)
            )
        )
        for tenant_id, user_id, name in legacy_rows.all():
            legacy_bucket = members_by_tenant.setdefault(tenant_id, {})
            legacy_bucket.setdefault(
                user_id,
                {
                    "user_id": user_id,
                    "name": name,
                    "role": "member",
                    "joined_at": None,
                    "source": "legacy",
                },
            )

        tenant_bindings: dict[int, int] = {}
        tenants = []
        for tenant_id, name, database_id, database_name in tenants_rows.all():
            tenant_bindings[tenant_id] = database_id
            members = sorted(
                members_by_tenant.get(tenant_id, {}).values(),
                key=lambda m: m["name"],
            )
            tenants.append(
                {
                    "id": tenant_id,
                    "name": name,
                    "member_count": len(members),
                    "owner_count": sum(
                        1 for m in members if m["role"] in ("owner", "admin")
                    ),
                    "database": (
                        {
                            "id": database_id,
                            "name": database_name,
                            "collection_count": collection_counts.get(database_id, 0),
                        }
                        if database_id
                        else None
                    ),
                    "members": members,
                }
            )

        databases = [
            {
                "id": db_id,
                "name": db_name,
                "description": description,
                "is_active": is_active,
                "collection_count": collection_counts.get(db_id, 0),
                "tenant_id": next(
                    (t for t, d in tenant_bindings.items() if d == db_id), None
                ),
            }
            for db_id, db_name, description, is_active in databases_rows.all()
        ]

        grants = [
            {
                "user_id": user_id,
                "database_id": database_id,
                "database_name": database_name,
                "can_read": can_read,
                "can_write": can_write,
                "can_manage": can_manage,
            }
            for (
                user_id,
                database_id,
                can_read,
                can_write,
                can_manage,
                database_name,
            ) in grants_rows.all()
        ]

        users = [
            {
                "id": uid,
                "name": uname,
                "role_id": role_id,
                "is_active": is_active,
                "email": email,
                "tenant_id": user_tenant_id,
                "last_login_at": last_login.isoformat() if last_login else None,
                "daily_token_limit": daily_limit,
                "daily_token_used": daily_usage.get(uid, 0),
                "monthly_token_limit": monthly_limit,
                "monthly_token_used": monthly_usage.get(uid, 0),
                "total_token_used": total_usage.get(uid, 0),
                # 与 /api/current 同一份语义：让界面自己判 limit<=0 会长出第二套口径
                # （那边已经这么做了，所以成员页与设置页对「无限制」的说法才会一致）。
                "daily_unlimited": is_unlimited(daily_limit),
                "monthly_unlimited": is_unlimited(monthly_limit),
            }
            for (
                uid,
                uname,
                role_id,
                is_active,
                email,
                user_tenant_id,
                last_login,
                daily_limit,
                monthly_limit,
            ) in users_rows.all()
        ]

        member_user_ids = {m["user_id"] for b in members_by_tenant.values() for m in b.values()}
        return {
            "tenants": tenants,
            "databases": databases,
            "grants": grants,
            "users": users,
            "unaffiliated_user_count": sum(1 for u in users if u["id"] not in member_user_ids),
        }

    async def get_tenant_by_id(self, tenant_id: int):
        result = await self.relation_db.execute(
            select(Tenant).where(Tenant.id == tenant_id)
        )
        return result.scalar_one_or_none()

    async def get_tenant_by_name(self, name: str):
        result = await self.relation_db.execute(
            select(Tenant).where(Tenant.name == name)
        )
        return result.scalar_one_or_none()

    async def search_tenants(self, value: str):
        result = await self.relation_db.execute(
            select(Tenant).where(Tenant.name.contains(value))
        )
        return result.scalars().all()

    async def delete_tenant(self, tenant_id: int):
        tenant = await self.get_tenant_by_id(tenant_id)
        if not tenant:
            raise HTTPException(status_code=404, detail="Tenant not found")
        # 原来返回 message 时引用了已 delete 的对象属性，SQLAlchemy 会在这之后
        # 因为会话过期而拒绝读取；先把名字取出来。
        name = tenant.name
        await self.relation_db.delete(tenant)
        try:
            await self.relation_db.commit()
        except IntegrityError:
            await self.relation_db.rollback()
            raise HTTPException(
                status_code=400, detail="关联数据删除失败，请先清理相关资源"
            )
        return {"message": f"Tenant {name} 已删除"}

    async def create_tenant(self, name: str):
        existing = await self.get_tenant_by_name(name)
        if existing:
            raise HTTPException(status_code=400, detail="Tenant already exists")
        tenant = Tenant(name=name)
        self.relation_db.add(tenant)
        try:
            await self.relation_db.commit()
            await self.relation_db.refresh(tenant)
        except IntegrityError:
            await self.relation_db.rollback()
            raise HTTPException(status_code=400, detail="创建租户失败")
        return tenant

    async def get_members(self, tenant_id: int):
        # 成员列表要显示用户名，只返回 user_id 会让前端为每个人再查一次
        result = await self.relation_db.execute(
            select(TenantMember, User.name)
            .join(User, User.id == TenantMember.user_id)
            .where(TenantMember.tenant_id == tenant_id)
            .order_by(User.name)
        )
        return [
            {
                "user_id": m.user_id,
                "name": name,
                "role": m.role,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m, name in result.all()
        ]

    async def add_member(self, tenant_id: int, user_id: int, role: str = "member"):
        if not await self.get_tenant_by_id(tenant_id):
            raise HTTPException(status_code=404, detail="Tenant not found")
        user = await self.relation_db.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="用户不存在")

        existing = await self.relation_db.execute(
            select(TenantMember).where(
                TenantMember.user_id == user_id,
                TenantMember.tenant_id == tenant_id,
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="用户已在该租户中")

        self.relation_db.add(TenantMember(user_id=user_id, tenant_id=tenant_id, role=role))
        # 双轨成员制：另一套归属记在 user.tenant_id 上。只写 TenantMember 的话，
        # 走旧口径的界面仍显示这个人「无租户」。写入时对齐，读侧才能收敛成一个口径。
        if user.tenant_id is None:
            user.tenant_id = tenant_id
        await self.relation_db.commit()
        return {"message": "已加入租户"}

    async def remove_member(self, tenant_id: int, user_id: int):
        result = await self.relation_db.execute(
            select(TenantMember).where(
                TenantMember.user_id == user_id,
                TenantMember.tenant_id == tenant_id,
            )
        )
        member = result.scalar_one_or_none()
        if not member:
            raise HTTPException(status_code=404, detail="用户不在此租户中")
        await self.relation_db.delete(member)

        user = await self.relation_db.get(User, user_id)
        if user and user.tenant_id == tenant_id:
            # 旧口径的归属指向的正是这个被退出的租户：改指向他剩下的任一租户，否则清空。
            remaining = await self.relation_db.execute(
                select(TenantMember.tenant_id)
                .where(TenantMember.user_id == user_id)
                .limit(1)
            )
            row = remaining.first()
            user.tenant_id = row[0] if row else None
        await self.relation_db.commit()
        return {"message": "已移出租户"}


def get_tenant_service(
    relation_db: AsyncSession = Depends(get_relation_db),
    database_service: DatabaseService = Depends(get_database_service),
):
    return TenantService(relation_db=relation_db, database_service=database_service)
