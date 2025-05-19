from fastapi import Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from src.base.database import get_db
from src.base.models import Database, Tenant


class TenantService:
    def __init__(self, db: AsyncSession = Depends(get_db)):
        self.db = db

    async def get_all_tenants(self):
        result = await self.db.execute(select(Tenant))
        return result.scalars().all()

    async def get_tenant_by_name(self, name: str):
        result = await self.db.execute(select(Tenant).where(Tenant.name == name))
        return result.scalar_one_or_none()

    async def delete_tenant(self, name: str):
        existing = await self.get_tenant_by_name(name)
        if not existing:
            raise HTTPException(status_code=404, detail="Tenant not found")
        await self.db.delete(existing)
        try:
            await self.db.commit()
            await self.db.flush()
        except IntegrityError:
            await self.db.rollback()
            raise HTTPException(status_code=400, detail=f"Relation Error")
        return existing

    async def create_tenant(
        self, name: str, database_name: str, database_description: str
    ):
        existing = await self.get_tenant_by_name(name)
        if existing:
            raise HTTPException(status_code=400, detail="Tenant already exists")
        existing_database = await self.db.execute(
            select(Database).where(Database.name == database_name)
        )
        if not existing_database:
            raise HTTPException(status_code=400, detail="Database does not exist")
        database = Database(name=database_name, description=database_description)
        self.db.add(database)
        tenant = Tenant(name=name, database=database)
        self.db.add(tenant)
        try:
            await self.db.commit()
            await self.db.flush()
        except IntegrityError:
            await self.db.rollback()
            raise HTTPException(status_code=400, detail=f"Relation Error")
        return tenant


def get_tenant(db: AsyncSession = Depends(get_db)) -> TenantService:
    return TenantService(db=db)
