from fastapi import Depends, HTTPException
from pymilvus import MilvusClient
from sqlalchemy.ext.asyncio import AsyncSession
from src.client import get_milvus_service, get_relation_db


class DatabaseService:
    def __init__(
        self,
        milvus_service: MilvusClient,
        relation_db: AsyncSession,
    ):
        self.milvus_service = milvus_service
        self.relation_db = relation_db

    async def create_database_service(
        self,
        db_name: str,
        tenant_name: str,
        replica_number: int = 1,
        description: str = "",
    ):
        try:
            self.milvus_service.create_database(
                db_name=db_name,
                properties={
                    "tenant": tenant_name,
                    "description": description,
                    "database.replica.name": replica_number,
                },
            )
        except Exception as e:
            if (db_name != "default"):
              self.milvus_service.drop_database(db_name=db_name)
            raise HTTPException(status_code=400, detail=f"Create {db_name} Error: {e}")
        return f"Create {db_name} (tenant: {tenant_name}) OK"

    async def database_get_all_service(self):
        return self.milvus_service.list_databases()

    async def database_get_all_detail_service(self):
        databases = self.milvus_service.list_databases()
        res = []
        for db_name in databases:
            item = self.milvus_service.describe_database(db_name=db_name)
            res.append(item)
        return res

    async def database_get_describe_service(self, db_name: str):
        return self.milvus_service.describe_database(db_name=db_name)

    async def database_delete_service(self, db_name: str):
        self.milvus_service.drop_database(db_name=db_name)
        return f"Delete {db_name} OK"

    async def database_reset_service(self):
        databases = self.milvus_service.list_databases()
        for database in databases:
            if database != "default":
                self.milvus_service.drop_database(db_name=database)
        await self.relation_db.execute("DELETE FROM tenant")
        await self.relation_db.commit()
        return f"Reset OK"

    async def database_limit_collection_service(self, db_name: str, limit: int):
        self.milvus_service.alter_database_properties(
            db_name=db_name, properties={"database.max.collections": limit}
        )
        return f"Limit {db_name} to {limit} OK"


def get_database_service(
    milvus_service: MilvusClient = Depends(get_milvus_service),
    relation_db: AsyncSession = Depends(get_relation_db),
):
    return DatabaseService(milvus_service=milvus_service, relation_db=relation_db)
