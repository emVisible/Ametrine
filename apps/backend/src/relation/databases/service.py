from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from src.base.database import get_db
from src.base.models import Database
from sqlalchemy.orm import joinedload


class DatabaseService:
    def __init__(self, db: AsyncSession = Depends(get_db)):
        self.db = db

    async def database_get_all_service(self):
        result = await self.db.execute(select(Database))
        return result.scalars().all()

    async def database_get_service(self, name: str):
        result = await self.db.execute(
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
        self.db.add(database)
        await self.db.commit()
        await self.db.refresh(database)
        return database


def get_database(db: AsyncSession = Depends(get_db)) -> DatabaseService:
    return DatabaseService(db=db)
