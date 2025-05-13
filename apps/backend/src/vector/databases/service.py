from collections.abc import Callable
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.exc import IntegrityError
from fastapi import Depends, HTTPException
from pymilvus import MilvusClient

from src.base.database import get_db
from ..service import get_milvus_service
from src.base.models import Tenant


class DatabaseService:
    def __init__(
        self,
        client: MilvusClient = Depends(get_milvus_service),
        pg: AsyncSession = Depends(get_db),
    ):
        self.client = client
        self.pg = pg

    async def create_database_service(
        self, db_name: str, tenant_name: str, replica_number: int = 1
    ):
        # 1. Milvus 中创建数据库
        self.client.create_database(
            db_name=db_name,
            properties={
                "tenant": tenant_name,
                "database.replica.name": replica_number,
            },
        )

        # 2. PostgreSQL 中创建 tenant 记录
        new_tenant = Tenant(name=tenant_name, database=db_name)

        self.pg.add(new_tenant)
        try:
            await self.pg.commit()
        except IntegrityError:
            await self.pg.rollback()
            # ⚠️ 删除 Milvus 数据库（以防脏数据残留）
            self.client.drop_database(db_name=db_name)
            raise HTTPException(
                status_code=400,
                detail=f"Tenant '{tenant_name}' or database '{db_name}' already exists",
            )

        return f"Create {db_name} (tenant: {tenant_name}) OK"

    async def database_use(self, db_name: str):
        self.client.use_database(db_name=db_name)
        return True

    async def database_get_all_service(self):
        return self.client.list_databases()

    async def database_get_all_detail_service(self):
        databases = self.client.list_databases()
        res = []
        for db_name in databases:
            item = self.client.describe_database(db_name=db_name)
            res.append(item)
        return res

    async def database_get_describe_service(self, db_name: str):
        return self.client.describe_database(db_name=db_name)

    async def database_delete_service(self, db_name: str):
        self.client.drop_database(db_name=db_name)

        # 同时删除 tenant 表记录
        result = await self.pg.execute(select(Tenant).where(Tenant.database == db_name))
        tenant = result.scalar_one_or_none()

        if tenant:
            await self.pg.delete(tenant)
            await self.pg.commit()

        return f"Delete {db_name} OK"

    async def database_reset_service(self):
        databases = self.client.list_databases()
        for database in databases:
            if database != "default":
                self.client.drop_database(db_name=database)
        # ⚠️ 同步清空 tenant 表
        await self.pg.execute("DELETE FROM tenant")
        await self.pg.commit()
        return f"Reset OK"

    async def database_limit_collection_service(self, db_name: str, limit: int):
        self.client.alter_database_properties(
            db_name=db_name, properties={"database.max.collections": limit}
        )
        return f"Limit {db_name} to {limit} OK"


def get_database_service(
    milvus_service: MilvusClient = Depends(get_milvus_service),
    db: AsyncSession = Depends(get_db),
) -> DatabaseService:
    return DatabaseService(client=milvus_service, pg=db)
