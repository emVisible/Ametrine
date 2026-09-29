# src/permissions/service.py
from fastapi import Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from src.client import get_relation_db
from src.user.auth.service import is_admin as is_admin_
from src.models import (
    User,
    Tenant,
    TenantMember,
    Database,
    Collection,
    Document,
    UserDatabasePermission,
)


class PermissionService:
    def __init__(self, relation_db: AsyncSession):
        self.relation_db = relation_db

    async def require_read_database(self, user_id: int, database_name: str):
        if not await self.can_read_database(user_id, database_name):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"您无权访问知识库 {database_name}",
            )

    async def require_write_database(self, user_id: int, database_name: str):
        if not await self.can_write_database(user_id, database_name):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"您无权写入知识库 {database_name}",
            )

    async def require_admin(self, user_id: int):
        if not await self.is_admin(user_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="仅管理员可执行此操作",
            )

    async def get_user_database_permissions(self, user_id: int):
        # 原来每条授权再查一次 Database —— 面板里一个用户几十条授权就是几十次往返。
        result = await self.relation_db.execute(
            select(UserDatabasePermission, Database.name)
            .outerjoin(Database, Database.id == UserDatabasePermission.database_id)
            .where(UserDatabasePermission.user_id == user_id)
            .order_by(Database.name)
        )
        return [
            {
                "id": p.id,
                "database_id": p.database_id,
                "database_name": db_name,
                "can_read": p.can_read,
                "can_write": p.can_write,
                "can_manage": p.can_manage,
            }
            for p, db_name in result.all()
        ]

    # ═══ 角色判断 ═══
    async def is_admin(self, user_id: int) -> bool:
        result = await self.relation_db.execute(select(User).where(User.id == user_id))
        return is_admin_(result.scalar_one_or_none())

    async def is_tenant_owner(self, user_id: int, tenant_id: int) -> bool:
        result = await self.relation_db.execute(
            select(TenantMember).where(
                TenantMember.user_id == user_id,
                TenantMember.tenant_id == tenant_id,
                TenantMember.role == "owner",
            )
        )
        return result.scalar_one_or_none() is not None

    async def is_tenant_member(self, user_id: int, tenant_id: int) -> bool:
        result = await self.relation_db.execute(
            select(TenantMember).where(
                TenantMember.user_id == user_id,
                TenantMember.tenant_id == tenant_id,
            )
        )
        return result.scalar_one_or_none() is not None

    # ═══ 定位 ═══
    async def _locate_database(self, database_name: str):
        """按名字一次取回 (database_id, tenant_id)。

        两件事：归属关系存在 Tenant.database_id 上，Database 侧没有 tenant_id 列；
        而 db.tenant 这类关系属性在 AsyncSession 里未预加载就访问会抛 MissingGreenlet。
        """
        result = await self.relation_db.execute(
            select(Database.id, Tenant.id)
            .outerjoin(Tenant, Tenant.database_id == Database.id)
            .where(Database.name == database_name)
        )
        return result.first()

    # ═══ 数据库权限 ═══
    async def can_read_database(self, user_id: int, database_name: str) -> bool:
        if await self.is_admin(user_id):
            return True

        located = await self._locate_database(database_name)
        if not located:
            return False
        db_id, tenant_id = located

        # 1. 直接授权检查
        perm_result = await self.relation_db.execute(
            select(UserDatabasePermission).where(
                UserDatabasePermission.user_id == user_id,
                UserDatabasePermission.database_id == db_id,
                UserDatabasePermission.can_read == True,
            )
        )
        if perm_result.scalar_one_or_none():
            return True

        # 2. 通过租户间接授权
        if tenant_id:
            return await self.is_tenant_member(user_id, tenant_id)

        return False

    async def can_write_database(self, user_id: int, database_name: str) -> bool:
        if await self.is_admin(user_id):
            return True

        located = await self._locate_database(database_name)
        if not located:
            return False
        db_id, tenant_id = located

        # 直接授权
        perm_result = await self.relation_db.execute(
            select(UserDatabasePermission).where(
                UserDatabasePermission.user_id == user_id,
                UserDatabasePermission.database_id == db_id,
                UserDatabasePermission.can_write == True,
            )
        )
        if perm_result.scalar_one_or_none():
            return True

        # 租户 owner 可以写
        if tenant_id:
            return await self.is_tenant_owner(user_id, tenant_id)

        return False

    # ═══ 集合权限（继承数据库） ═══
    async def can_access_collection(
        self, user_id: int, collection_name: str, require_write: bool = False
    ) -> bool:
        from sqlalchemy.orm import joinedload

        result = await self.relation_db.execute(
            select(Collection)
            .where(Collection.name == collection_name)
            .options(joinedload(Collection.database))
        )
        col = result.scalar_one_or_none()
        if not col:
            return False
        if require_write:
            return await self.can_write_database(user_id, col.database.name)
        return await self.can_read_database(user_id, col.database.name)

    # ═══ 文档权限（继承集合 → 数据库） ═══
    async def can_access_document(
        self, user_id: int, document_id: str, require_write: bool = False
    ) -> bool:
        # 原来文档 → 集合 → 库 三次往返才拿到一个 db.name，这里一条 join 取回。
        result = await self.relation_db.execute(
            select(Database.name)
            .join(Collection, Collection.database_id == Database.id)
            .join(Document, Document.collection_id == Collection.id)
            .where(Document.id == document_id)
        )
        row = result.first()
        if not row:
            return False
        if require_write:
            return await self.can_write_database(user_id, row[0])
        return await self.can_read_database(user_id, row[0])

    # ═══ 资源过滤 ═══
    async def get_accessible_databases(self, user_id: int):
        if await self.is_admin(user_id):
            return await self._get_all_databases()

        # 直接授权 + 租户授权
        direct_result = await self.relation_db.execute(
            select(UserDatabasePermission.database_id).where(
                UserDatabasePermission.user_id == user_id,
                UserDatabasePermission.can_read == True,
            )
        )
        direct_ids = [r[0] for r in direct_result.all()]

        # 通过租户（归属列在 Tenant.database_id 上，不是 Database.tenant_id）
        member_result = await self.relation_db.execute(
            select(TenantMember.tenant_id).where(
                TenantMember.user_id == user_id,
            )
        )
        tenant_ids = [r[0] for r in member_result.all()]
        tenant_db_ids = []
        if tenant_ids:
            db_result = await self.relation_db.execute(
                select(Tenant.database_id).where(
                    Tenant.id.in_(tenant_ids), Tenant.database_id.is_not(None)
                )
            )
            tenant_db_ids = [r[0] for r in db_result.all()]

        all_ids = set(direct_ids + tenant_db_ids)
        if not all_ids:
            return []

        result = await self.relation_db.execute(
            select(Database, Tenant.name)
            .outerjoin(Tenant, Tenant.database_id == Database.id)
            .where(Database.id.in_(all_ids))
            .order_by(Database.name)
        )
        return self._rows(result.all())

    async def _get_all_databases(self):
        result = await self.relation_db.execute(
            select(Database, Tenant.name)
            .outerjoin(Tenant, Tenant.database_id == Database.id)
            .order_by(Database.name)
        )
        return self._rows(result.all())

    @staticmethod
    def _rows(pairs):
        return [
            {
                "id": db.id,
                "name": db.name,
                "description": db.description,
                "is_active": db.is_active,
                "tenant_name": tenant_name,
            }
            for db, tenant_name in pairs
        ]

    async def set_database_permission(
        self,
        user_id: int,
        database_id: int,
        can_read: bool = True,
        can_write: bool = False,
        can_manage: bool = False,
    ):
        result = await self.relation_db.execute(
            select(UserDatabasePermission).where(
                UserDatabasePermission.user_id == user_id,
                UserDatabasePermission.database_id == database_id,
            )
        )
        perm = result.scalar_one_or_none()
        if perm:
            perm.can_read = can_read
            perm.can_write = can_write
            perm.can_manage = can_manage
        else:
            perm = UserDatabasePermission(
                user_id=user_id,
                database_id=database_id,
                can_read=can_read,
                can_write=can_write,
                can_manage=can_manage,
            )
            self.relation_db.add(perm)
        await self.relation_db.commit()
        return perm

    async def remove_database_permission(self, user_id: int, database_id: int):
        result = await self.relation_db.execute(
            select(UserDatabasePermission).where(
                UserDatabasePermission.user_id == user_id,
                UserDatabasePermission.database_id == database_id,
            )
        )
        perm = result.scalar_one_or_none()
        if perm:
            await self.relation_db.delete(perm)
            await self.relation_db.commit()
        return True


def get_permission_service(relation_db: AsyncSession = Depends(get_relation_db)):
    return PermissionService(relation_db=relation_db)
