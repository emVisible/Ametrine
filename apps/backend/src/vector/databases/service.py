from collections.abc import Callable

from fastapi import Depends
from pymilvus import MilvusClient

from ..service import get_milvus_service


class DatabaseService:
    def __init__(self, client: MilvusClient = Depends(get_milvus_service)):
        self.client = client

    async def database_use(self, db_name: str):
        self.client.use_database(db_name=db_name)
        return True

    async def database_get_all_service(self):
        return self.client.list_databases()

    async def create_database_service(
        self, db_name: str, tenant_name: str, replica_number: int = 1
    ):
        self.client.create_database(
            db_name=db_name,
            properties={
                "tenant": tenant_name,
                "database.replica.name": replica_number,
            },
        )
        return f"Create {db_name} OK"

    async def database_get_describe_service(self, db_name: str):
        return self.client.describe_database(db_name=db_name)

    async def database_delete_service(self, db_name: str):
        self.client.drop_database(db_name=db_name)
        return f"Deleete {db_name} OK"

    async def database_reset_service(self):
        databases = self.client.list_databases()
        for database in databases:
            if not database == "default":
                self.client.drop_database(db_name=database)
        return f"Reset OK"

    async def database_limit_collection_service(self, db_name: str, limit: int):
        self.client.alter_database_properties(
            db_name=db_name, properties={"database.max.collections": limit}
        )
        return f"Limit {db_name} to {limit} OK"


def get_database_service(
    milvus_service: MilvusClient = Depends(get_milvus_service),
) -> DatabaseService:
    return DatabaseService(client=milvus_service)
