from fastapi import Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from src.client import get_relation_db
from src.models import Database, Tenant
from ..databases.service import DatabaseService, get_database_service


class TenantService:
    def __init__(self, relation_db: AsyncSession, database_service: DatabaseService):
        self.relation_db = relation_db
        self.database = database_service

    async def get_all_tenants(self):
        res = []
        tenants = await self.relation_db.execute(select(Tenant))
        for tenant in tenants.scalars().all():
            res.append(
                {
                    "id": tenant.id,
                    "name": tenant.name,
                    "database": await self.database.database_get_by_id_service(
                        tenant.database_id
                    ),
                }
            )
        return res

    async def get_tenant_by_name(self, name: str):
        result = await self.relation_db.execute(
            select(Tenant).where(Tenant.name == name)
        )
        return result.scalar_one_or_none()

    async def delete_tenant(self, name: str):
        existing = await self.get_tenant_by_name(name)
        if not existing:
            raise HTTPException(status_code=404, detail="Tenant not found")
        await self.relation_db.delete(existing)
        try:
            await self.relation_db.commit()
            await self.relation_db.flush()
        except IntegrityError:
            await self.relation_db.rollback()
            raise HTTPException(status_code=400, detail=f"Relation Error")
        return existing

    async def create_tenant(
        self, name: str, database_name: str, database_description: str
    ):
        # 如果tenant存在, 报错
        existing = await self.get_tenant_by_name(name)
        if existing is not None:
            raise HTTPException(status_code=400, detail="Tenant already exists")
        # 如果绑定的数据库不存在, 创建数据库
        result = await self.relation_db.execute(
            select(Database).where(Database.name == database_name)
        )
        database = result.scalar_one_or_none()
        if not database:
            database = await self.database.database_create_service(
                name=database_name, description=database_description
            )
        tenant = Tenant(name=name, database_id=database.id)
        self.relation_db.add(tenant)
        try:
            await self.relation_db.commit()
            await self.relation_db.flush()
        except IntegrityError:
            await self.relation_db.rollback()
            raise HTTPException(status_code=400, detail=f"Relation Error")
        return tenant


def get_tenant_service(
    relation_db: AsyncSession = Depends(get_relation_db),
    database_service: DatabaseService = Depends(get_database_service),
):
    return TenantService(relation_db=relation_db, database_service=database_service)
