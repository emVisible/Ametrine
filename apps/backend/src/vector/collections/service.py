from collections.abc import Callable

from fastapi import Depends
from pymilvus import CollectionSchema, DataType, FieldSchema, MilvusClient
from src.utils import use_database_before

from ..service import get_milvus_service


class CollectionService:
    def __init__(
        self,
        client: MilvusClient,
    ):
        self.client = client

    @use_database_before()
    async def collection_call(self, collection_name: str, fn: Callable):
        self.client.load_collection(collection_name=collection_name)
        fn()
        self.client.release_collection(collection_name=collection_name)
        return True

    @use_database_before()
    async def collection_get_all_service(self, database_name: str):
        return self.client.list_collections()

    @use_database_before()
    async def collection_get_all_detail_service(self, database_name: str):
        collections = self.client.list_collections()
        res = []
        for collection_name in collections:
            collection = self.client.describe_collection(
                collection_name=collection_name
            )
            res.append(collection)
        return res

    @use_database_before()
    async def collection_get_describe_service(
        self, collection_name: str, database_name: str
    ):
        return self.client.describe_collection(collection_name=collection_name)

    @use_database_before()
    async def collection_create_service(
        self, collection_name: str, database_name: str, description: str
    ):
        name = collection_name
        already_exist = self.client.has_collection(collection_name=name)
        if already_exist:
            return "Collection already exists"
        schema = CollectionSchema(
            fields=[
                FieldSchema(
                    name="id", dtype=DataType.INT64, is_primary=True, auto_id=True
                ),
                FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=1024),
                FieldSchema(name="doc_id", dtype=DataType.VARCHAR, max_length=100),
                FieldSchema(name="chunk_id", dtype=DataType.INT64),
            ],
            description=description,
        )
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

    @use_database_before()
    async def collection_rename_service(
        self, old_name: str, new_name: str, database_name: str
    ):
        self.client.rename_collection(
            old_name=old_name, new_name=new_name, target_db=database_name
        )
        return f"Rename from {old_name} to {new_name} in {database_name} OK"

    @use_database_before()
    async def collection_delete_service(self, collection_name: str, database_name: str):
        self.client.drop_collection(collection_name=collection_name)
        return f"Deleete {collection_name} OK"

    @use_database_before()
    async def collection_reset_service(self, database_name: str):
        collections = self.client.list_collections()
        for collection_name in collections:
            self.client.drop_collection(collection_name=collection_name)
        return "Reset OK"


def get_collection_service(
    milvus_service: MilvusClient = Depends(get_milvus_service),
) -> CollectionService:
    return CollectionService(client=milvus_service)
