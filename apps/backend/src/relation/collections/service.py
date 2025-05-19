from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from src.base.database import get_db
from src.base.models import Collection


class CollectionService:
    def __init__(self, db: AsyncSession = Depends(get_db)):
        self.db = db

    async def collection_get_all_service(self):
        result = await self.db.execute(select(Collection))
        return result.scalars().all()

    async def collection_get_all_specific_service(self, database_id: int):
        result = await self.db.execute(
            select(Collection).where(Collection.database_id == database_id)
        )
        return result.scalars().all()

    async def collection_get_service(self, name: str):
        result = await self.db.execute(
            select(Collection).where(Collection.name == name)
        )
        return result.scalar_one_or_none()

    async def collection_create_service(
        self, name: str, database_id: int, description: str
    ):
        existing = await self.collection_get_service(name)
        if existing:
            raise HTTPException(status_code=400, detail="Collection already exists")
        collection = Collection(
            name=name, database_id=database_id, description=description
        )
        self.db.add(collection)
        await self.db.commit()
        await self.db.refresh(collection)
        return collection


def get_collection(db: AsyncSession = Depends(get_db)) -> CollectionService:
    return CollectionService(db=db)
