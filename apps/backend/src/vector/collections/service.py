from fastapi import Depends
from pymilvus import (
    MilvusClient,
    CollectionSchema,
    FieldSchema,
    DataType,
)
from collections.abc import Callable
from ..service import get_milvus_service


class CollectionService:
    def __init__(self, client: MilvusClient):
        self.client = client
        self.schema = CollectionSchema(
            fields=[
                FieldSchema(
                    name="id", dtype=DataType.INT64, is_primary=True, auto_id=True
                ),
                FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=1024),
                FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=65535),
                FieldSchema(name="source", dtype=DataType.VARCHAR, max_length=500),
            ],
            description="My document collection",
        )

    async def collection_call(self, collection_name: str, fn: Callable):
        self.client.load_collection(collection_name=collection_name)
        fn()
        self.client.release_collection(collection_name=collection_name)
        return True

    async def collection_get_all_service(self):
        return self.client.list_collections()

    async def collection_get_describe_service(self, collection_name: str):
        return self.client.describe_collection(collection_name=collection_name)

    async def collection_create_service(self, collection_name: str):
        name = collection_name
        already_exist = self.client.has_collection(collection_name=name)
        if already_exist:
            return "Collection already exists"
        schema = self.schema
        self.client.create_collection(collection_name=name, schema=schema)
        index_params = self.client.prepare_index_params()
        index_params.add_index(
            field_name="embedding",
            index_type="IVF_FLAT",
            index_name="vector_index",
            metric_type="L2",
            params={
                "nlist": 256,
            },
        )
        self.client.create_index(collection_name=name, index_params=index_params)
        return self.client.describe_collection(collection_name=name)

    async def collection_rename_service(
        self, old_name: str, new_name: str, target_db: str
    ):
        self.client.rename_collection(
            old_name=old_name, new_name=new_name, target_db=target_db
        )
        return f"Rename from {old_name} to {new_name} in {target_db} OK"

    async def collection_delete_service(self, collection_name: str):
        self.client.drop_collection(collection_name=collection_name)
        return f"Deleete {collection_name} OK"

    async def collection_reset_service(self):
        collections = await self.collection_get_all_service()
        for collection_name in collections:
            self.client.drop_collection(collection_name=collection_name)
        return "Reset OK"


def get_collection_service(
    milvus_service: MilvusClient = Depends(get_milvus_service),
) -> CollectionService:
    return CollectionService(client=milvus_service)
