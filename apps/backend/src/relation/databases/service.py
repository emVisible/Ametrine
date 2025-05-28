from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import joinedload
from src.client import get_relation_db
from src.models import Database


class DatabaseService:
    def __init__(self, relation_db: AsyncSession):
        self.relation_db = relation_db

    async def database_get_all_service(self):
        result = await self.relation_db.execute(select(Database))
        return result.scalars().all()

    async def database_get_service(self, name: str):
        result = await self.relation_db.execute(
            select(Database)
            .where(Database.name == name)
            .options(joinedload(Database.tenant))
        )
        return result.scalar_one_or_none()

    async def database_create_service(self, name: str, description: str):
        existing = await self.database_get_service(name)
        if existing:
            raise HTTPException(status_code=400, detail="Database already exists")
        database = Database(name=name, description=description)
        self.relation_db.add(database)
        await self.relation_db.commit()
        await self.relation_db.refresh(database)
        return database


def get_database_service(relation_db: AsyncSession = Depends(get_relation_db)):
    return DatabaseService(relation_db=relation_db)
