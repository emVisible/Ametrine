from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from src.client import get_relation_db
from src.models import Collection


class CollectionService:
    def __init__(self, relation_db: AsyncSession):
        self.relation_db = relation_db

    async def collection_get_all_service(self):
        result = await self.relation_db.execute(select(Collection))
        return result.scalars().all()

    async def collection_get_all_specific_service(self, database_id: int):
        result = await self.relation_db.execute(
            select(Collection).where(Collection.database_id == database_id)
        )
        return result.scalars().all()

    async def collection_get_service(self, name: str):
        result = await self.relation_db.execute(
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
        self.relation_db.add(collection)
        await self.relation_db.commit()
        await self.relation_db.refresh(collection)
        return collection


def get_collection_service(relation_db: AsyncSession = Depends(get_relation_db)):
    return CollectionService(relation_db=relation_db)
