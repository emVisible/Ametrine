from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from src.base.database import get_db
from src.base.models import Tenant


class TenantService:
    def __init__(self, db: AsyncSession = Depends(get_db)):
        self.db = db

    async def get_all_tenants(self):
        result = await self.db.execute(select(Tenant))
        return result.scalars().all()

    async def get_tenant_by_name(self, name: str):
        result = await self.db.execute(select(Tenant).where(Tenant.name == name))
        return result.scalar_one_or_none()

    async def create_tenant(self, name: str, database: str):
        existing = await self.get_tenant_by_name(name)
        if existing:
            raise HTTPException(status_code=400, detail="Tenant already exists")
        tenant = Tenant(name=name, database=database)
        self.db.add(tenant)
        await self.db.commit()
        await self.db.refresh(tenant)
        return tenant


def get_tenant_service(db: AsyncSession = Depends(get_db)) -> TenantService:
    return TenantService(db=db)