from fastapi import Depends, HTTPException
from pymilvus import MilvusClient
from sqlalchemy.ext.asyncio import AsyncSession
from src.client import get_milvus_service, get_relation_db
from src.middleware.logger import config_logger


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
        except Exception as e:  # noqa: BLE001
            # 原来这里在 except 里又去 `drop_database(同一个名字)`：没建成的东西没什么可删，
            # 而那句 drop 自己也会抛 —— 结果真正的失败原因（口令？重名？非法名字？）
            # 被第二个异常整个盖掉，日志里只剩一句「drop database not exist」。
            # 细节进日志，客户端只看类型名（R5 那条同一口径）。
            config_logger.error("milvus create_database(%s) failed: %s", db_name, str(e)[:300])
            raise HTTPException(
                status_code=400,
                detail=f"创建向量库 {db_name} 失败（{type(e).__name__}），详情见 ametrine.log。",
            ) from e
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
