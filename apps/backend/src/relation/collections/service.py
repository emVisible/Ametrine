from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from src.client import get_relation_db
from src.models import Collection, Database


class CollectionService:
    def __init__(self, relation_db: AsyncSession):
        self.relation_db = relation_db

    async def collection_get_all_service(self, database_ids=None):
        """database_ids 不为 None 时只返回这些库里的集合。

        `/collection/all` 原来一声不响地把**所有租户**的集合名与描述交出去
        （只要登录就行）—— 知识库的名字本身就是信息，而它是权限模型该管的东西。
        传 None 保留给「调用方自己已经判过」的内部路径。
        """
        query = select(Collection)
        if database_ids is not None:
            if not database_ids:
                return []
            query = query.where(Collection.database_id.in_(database_ids))
        result = await self.relation_db.execute(query)
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

    async def collection_database_name_service(self, name: str):
        """这个集合属于哪个库 —— 读权限判定要的是库，不是集合。"""
        result = await self.relation_db.execute(
            select(Database.name)
            .join(Collection, Collection.database_id == Database.id)
            .where(Collection.name == name)
        )
        return result.scalars().first()

    async def collection_create_service(
        self, name: str, database_id: int, description: str
    ):
        existing = await self.collection_get_service(name)
        if existing:
            # 只说「already exists」会让人以为自己没建成功然后反复重试：
            # 集合名是全局唯一，真实原因通常是「这个名字已经被另一个知识库占了」。
            owner = await self.collection_database_name_service(name)
            where = f"（它属于知识库「{owner}」）" if owner else ""
            raise HTTPException(
                status_code=400,
                detail=f"集合名「{name}」已被占用{where}，请换一个名字 —— 集合名目前是全局唯一的，不是每库一套",
            )
        collection = Collection(
            name=name, database_id=database_id, description=description
        )
        self.relation_db.add(collection)
        await self.relation_db.commit()
        await self.relation_db.refresh(collection)
        return collection

    async def collection_delete_service(self, name: str):
        collection = await self.collection_get_service(name)
        if not collection:
            raise HTTPException(status_code=404, detail="Collection not found")
        await self.relation_db.delete(collection)
        await self.relation_db.commit()


def get_collection_service(relation_db: AsyncSession = Depends(get_relation_db)):
    return CollectionService(relation_db=relation_db)
