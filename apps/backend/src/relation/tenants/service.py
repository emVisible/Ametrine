from fastapi import Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from src.client import get_relation_db
from src.models import Database, Tenant


class TenantService:
    def __init__(self, relation_db: AsyncSession):
        self.relation_db = relation_db

    async def get_all_tenants(self):
        result = await self.relation_db.execute(select(Tenant))
        return result.scalars().all()

    async def get_tenant_by_name(self, name: str):
        result = await self.relation_db.execute(select(Tenant).where(Tenant.name == name))
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
        existing = await self.get_tenant_by_name(name)
        if existing:
            raise HTTPException(status_code=400, detail="Tenant already exists")
        existing_database = await self.relation_db.execute(
            select(Database).where(Database.name == database_name)
        )
        if not existing_database:
            raise HTTPException(status_code=400, detail="Database does not exist")
        database = Database(name=database_name, description=database_description)
        self.relation_db.add(database)
        tenant = Tenant(name=name, database=database)
        self.relation_db.add(tenant)
        try:
            await self.relation_db.commit()
            await self.relation_db.flush()
        except IntegrityError:
            await self.relation_db.rollback()
            raise HTTPException(status_code=400, detail=f"Relation Error")
        return tenant


def get_tenant_service(relation_db: AsyncSession = Depends(get_relation_db)):
    return TenantService(relation_db=relation_db)
