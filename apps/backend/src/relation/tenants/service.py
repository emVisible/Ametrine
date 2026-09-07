from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from src.client import get_relation_db
from src.models import TenantMember, Tenant
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from src.client import get_relation_db
from ..databases.service import DatabaseService, get_database_service


class TenantService:
    def __init__(self, relation_db: AsyncSession, database_service: DatabaseService):
        self.relation_db = relation_db
        self.database = database_service

    async def get_all_tenants(self):
        result = await self.relation_db.execute(select(Tenant))
        tenants = result.scalars().all()
        res = []
        for tenant in tenants:
            database_name = None
            if tenant.database_id:
                database_name = await self.database.database_get_by_id_service(
                    tenant.database_id
                )
            res.append(
                {
                    "id": tenant.id,
                    "name": tenant.name,
                    "database": database_name,
                }
            )
        return res

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
        await self.relation_db.delete(tenant)
        try:
            await self.relation_db.commit()
        except IntegrityError:
            await self.relation_db.rollback()
            raise HTTPException(
                status_code=400, detail="关联数据删除失败，请先清理相关资源"
            )
        return {"message": f"Tenant {tenant.name} 已删除"}

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
        result = await self.relation_db.execute(
            select(TenantMember).where(TenantMember.tenant_id == tenant_id)
        )
        members = result.scalars().all()
        return [
            {
                "user_id": m.user_id,
                "role": m.role,
                "created_at": m.created_at.isoformat(),
            }
            for m in members
        ]

    async def add_member(self, tenant_id: int, user_id: int, role: str = "member"):
        existing = await self.relation_db.execute(
            select(TenantMember).where(
                TenantMember.user_id == user_id,
                TenantMember.tenant_id == tenant_id,
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="用户已在该租户中")

        member = TenantMember(user_id=user_id, tenant_id=tenant_id, role=role)
        self.relation_db.add(member)
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
        await self.relation_db.commit()
        return {"message": "已移出租户"}


def get_tenant_service(
    relation_db: AsyncSession = Depends(get_relation_db),
    database_service: DatabaseService = Depends(get_database_service),
):
    return TenantService(relation_db=relation_db, database_service=database_service)
