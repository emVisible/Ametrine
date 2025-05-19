from collections.abc import Callable

from fastapi import Depends, HTTPException
from pymilvus import MilvusClient
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from src.base.database import get_db
from src.base.models import Tenant

from ..service import get_milvus_service


class DatabaseService:
    def __init__(
        self,
        client: MilvusClient = Depends(get_milvus_service),
        pg: AsyncSession = Depends(get_db),
    ):
        self.client = client
        self.pg = pg

    async def create_database_service(
        self,
        db_name: str,
        tenant_name: str,
        replica_number: int = 1,
        description: str = "",
    ):
        try:
            self.client.create_database(
                db_name=db_name,
                properties={
                    "tenant": tenant_name,
                    "description": description,
                    "database.replica.name": replica_number,
                },
            )
        except Exception as e:
            self.client.drop_database(db_name=db_name)
            raise HTTPException(status_code=400, detail=f"Create {db_name} Error: {e}")
        return f"Create {db_name} (tenant: {tenant_name}) OK"

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
        return f"Delete {db_name} OK"

    async def database_reset_service(self):
        databases = self.client.list_databases()
        for database in databases:
            if database != "default":
                self.client.drop_database(db_name=database)
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
