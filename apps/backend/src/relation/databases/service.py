from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.orm import joinedload
from src.client import get_relation_db
from src.models import Database, Tenant


class DatabaseService:
    def __init__(self, relation_db: AsyncSession):
        self.relation_db = relation_db

    async def database_create_service(
        self, name: str, description: str, tenant_id: int = None
    ):
        existing = await self.database_get_service(name)
        if existing:
            raise HTTPException(status_code=400, detail="Database already exists")

        database = Database(name=name, description=description)
        self.relation_db.add(database)
        await self.relation_db.flush()

        if tenant_id:
            result = await self.relation_db.execute(
                select(Tenant).where(Tenant.id == tenant_id)
            )
            tenant = result.scalar_one_or_none()
            if tenant:
                tenant.database_id = database.id

        await self.relation_db.commit()
        await self.relation_db.refresh(database)
        return database

    async def _rows(self, databases, tenants_by_db: dict[int, str]):
        return [
            {
                "id": db.id,
                "name": db.name,
                "description": db.description,
                "is_active": db.is_active,
                "tenant_name": tenants_by_db.get(db.id),
            }
            for db in databases
        ]

    async def _tenant_names_by_database_id(self):
        """一次查完「哪个租户绑了哪个库」，替掉列表接口里每行一次的 Tenant 查询。"""
        result = await self.relation_db.execute(
            select(Tenant.database_id, Tenant.name).where(
                Tenant.database_id.is_not(None)
            )
        )
        return {row[0]: row[1] for row in result.all()}

    async def database_get_all_service(self):
        result = await self.relation_db.execute(select(Database))
        tenants_by_db = await self._tenant_names_by_database_id()
        return await self._rows(result.scalars().all(), tenants_by_db)

    async def database_get_all_for_user(self, user_id: int):
        """返回用户可访问的数据库列表。

        判定口径来自 accessible_database_ids —— 与 can_read_database、概览统计共用一个函数，
        否则就会出现「列表里看不到、但提问时却能检索到」的分裂。
        """
        from src.user.permissions.service import accessible_database_ids

        ids = await accessible_database_ids(self.relation_db, user_id)
        query = select(Database)
        if ids is not None:
            if not ids:
                return []
            query = query.where(Database.id.in_(ids))
        result = await self.relation_db.execute(query.order_by(Database.name))
        tenants_by_db = await self._tenant_names_by_database_id()
        return await self._rows(result.scalars().all(), tenants_by_db)

    async def database_get_service(self, name: str):
        result = await self.relation_db.execute(
            select(Database)
            .where(Database.name == name)
            .options(joinedload(Database.tenant))
        )
        db = result.scalar_one_or_none()
        if not db:
            return None
        return {
            "id": db.id,
            "name": db.name,
            "description": db.description,
            "is_active": db.is_active,
            "tenant_name": db.tenant.name if db.tenant else None,
        }

    async def database_get_by_id_service(self, db_id: int):
        if db_id is None:
            return None
        result = await self.relation_db.execute(
            select(Database)
            .where(Database.id == db_id)
            .options(joinedload(Database.tenant))
        )
        db = result.scalar_one_or_none()
        return db.name if db else None

    async def database_delete_service(self, name: str):
        # 原来这里把 database_get_service() 返回的 **字典** 交给 session.delete()，
        # 而 AsyncSession.delete() 只接受映射实例 —— 删除知识库与创建失败的回滚都会炸。
        result = await self.relation_db.execute(
            select(Database).where(Database.name == name)
        )
        db = result.scalar_one_or_none()
        if not db:
            raise HTTPException(status_code=404, detail="Database not found")
        # tenant.database_id 外键指向本行，先解绑再删，否则 400 而不是干净删除。
        tenant_result = await self.relation_db.execute(
            select(Tenant).where(Tenant.database_id == db.id)
        )
        for tenant in tenant_result.scalars().all():
            tenant.database_id = None
        await self.relation_db.delete(db)
        await self.relation_db.commit()


def get_database_service(relation_db: AsyncSession = Depends(get_relation_db)):
    return DatabaseService(relation_db=relation_db)
