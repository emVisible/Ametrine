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

    async def database_get_all_service(self):
        result = await self.relation_db.execute(select(Database))
        databases = result.scalars().all()
        res = []
        for db in databases:
            tenant_result = await self.relation_db.execute(
                select(Tenant).where(Tenant.database_id == db.id)
            )
            tenant = tenant_result.scalar_one_or_none()
            res.append(
                {
                    "id": db.id,
                    "name": db.name,
                    "description": db.description,
                    "is_active": db.is_active,
                    "tenant_name": tenant.name if tenant else None,
                }
            )
        return res

    async def database_get_all_for_user(self, user_id: int):
        """返回用户有权限访问的数据库列表"""
        from src.models import UserDatabasePermission, User

        # admin 看全部
        user_result = await self.relation_db.execute(
            select(User).where(User.id == user_id)
        )
        user = user_result.scalar_one_or_none()
        if user and user.role_id == 3:
            return await self.database_get_all_service()

        # 普通用户只看被授权的
        perm_result = await self.relation_db.execute(
            select(UserDatabasePermission.database_id).where(
                UserDatabasePermission.user_id == user_id,
                UserDatabasePermission.can_read == True,
            )
        )
        db_ids = [row[0] for row in perm_result.all()]
        if not db_ids:
            return []

        result = await self.relation_db.execute(
            select(Database).where(Database.id.in_(db_ids))
        )
        databases = result.scalars().all()
        res = []
        for db in databases:
            tenant_result = await self.relation_db.execute(
                select(Tenant).where(Tenant.database_id == db.id)
            )
            tenant = tenant_result.scalar_one_or_none()
            res.append(
                {
                    "id": db.id,
                    "name": db.name,
                    "description": db.description,
                    "is_active": db.is_active,
                    "tenant_name": tenant.name if tenant else None,
                }
            )
        return res

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
        db = await self.database_get_service(name)
        if not db:
            raise HTTPException(status_code=404, detail="Database not found")
        await self.relation_db.delete(db)
        await self.relation_db.commit()


def get_database_service(relation_db: AsyncSession = Depends(get_relation_db)):
    return DatabaseService(relation_db=relation_db)
