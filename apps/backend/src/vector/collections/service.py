from collections.abc import Callable

from fastapi import Depends
from pymilvus import CollectionSchema, DataType, FieldSchema, MilvusClient
from src.client import get_milvus_service
from src.config import (
    embedding_dimension,
    milvus_index_nlist,
    milvus_index_type,
    milvus_metric_type,
)
from src.utils.other import use_vector_database


class CollectionService:
    def __init__(
        self,
        milvus_service: MilvusClient,
    ):
        self.milvus_service = milvus_service

    @use_vector_database()
    async def collection_get_all_service(self, database_name: str):
        return self.milvus_service.list_collections()

    @use_vector_database()
    async def collection_get_all_detail_service(self, database_name: str):
        collections = self.milvus_service.list_collections()
        res = []
        for collection_name in collections:
            collection = self.milvus_service.describe_collection(
                collection_name=collection_name
            )
            res.append(collection)
        return res

    @use_vector_database()
    async def collection_get_describe_service(
        self, collection_name: str, database_name: str
    ):
        return self.milvus_service.describe_collection(collection_name=collection_name)

    @use_vector_database()
    async def collection_create_service(
        self, collection_name: str, database_name: str, description: str
    ):
        name = collection_name
        already_exist = self.milvus_service.has_collection(collection_name=name)
        if already_exist:
            return "Collection already exists"
        schema = CollectionSchema(
            fields=[
                FieldSchema(
                    name="id", dtype=DataType.INT64, is_primary=True, auto_id=True
                ),
                FieldSchema(
                    name="embedding",
                    dtype=DataType.FLOAT_VECTOR,
                    dim=embedding_dimension,
                ),
                FieldSchema(name="doc_id", dtype=DataType.VARCHAR, max_length=100),
                FieldSchema(name="chunk_id", dtype=DataType.INT64),
                FieldSchema(name="source_type", dtype=DataType.VARCHAR, max_length=40),
                FieldSchema(
                    name="embedding_model", dtype=DataType.VARCHAR, max_length=100
                ),
                FieldSchema(name="created_at", dtype=DataType.INT64),
            ],
            description=description,
        )
        self.milvus_service.create_collection(collection_name=name, schema=schema)
        index_params = self.milvus_service.prepare_index_params()
        index_params.add_index(
            field_name="embedding",
            index_type=milvus_index_type,
            index_name="vector_index",
            metric_type=milvus_metric_type,
            params={
                "nlist": milvus_index_nlist,
            },
        )
        self.milvus_service.create_index(
            collection_name=name, index_params=index_params
        )
        return self.milvus_service.describe_collection(collection_name=name)

    @use_vector_database()
    async def collection_rename_service(
        self, old_name: str, new_name: str, database_name: str
    ):
        self.milvus_service.rename_collection(
            old_name=old_name, new_name=new_name, target_db=database_name
        )
        return f"Rename from {old_name} to {new_name} in {database_name} OK"

    @use_vector_database()
    async def collection_delete_service(self, collection_name: str, database_name: str):
        self.milvus_service.drop_collection(collection_name=collection_name)
        return f"Deleete {collection_name} OK"

    @use_vector_database()
    async def collection_reset_service(self, database_name: str):
        collections = self.milvus_service.list_collections()
        for collection_name in collections:
            self.milvus_service.drop_collection(collection_name=collection_name)
        return "Reset OK"

    async def collection_reset_all_service(self):
        databases = self.milvus_service.list_databases()
        for database_name in databases:
            if database_name != "default":
                self.milvus_service.use_database(db_name=database_name)
                collections = self.milvus_service.list_collections()
                for collection_name in collections:
                    self.milvus_service.drop_collection(collection_name=collection_name)
                self.milvus_service.drop_database(db_name=database_name)
        return "Reset OK"


def get_collection_service(milvus_service: MilvusClient = Depends(get_milvus_service)):
    return CollectionService(milvus_service=milvus_service)
