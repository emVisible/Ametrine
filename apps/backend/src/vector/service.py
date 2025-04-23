import os
from pathlib import Path
from fastapi import UploadFile, HTTPException
from pymilvus import (
    MilvusClient,
    CollectionSchema,
    FieldSchema,
    DataType,
)
from .loader import process_documents
from src.xinference.service import embedding_function, rerank_model
from src.vector.dto.collection import (
    CollectionRenameDto,
    DocumentQueryServiceDto,
)

client = MilvusClient(host="localhost", port="19530")


class Schemas:
    def __init__(self):
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


class CollectionService:
    async def collection_get_all_service(self):
        return client.list_collections()

    async def collection_get_describe_service(self, collection_name: str):
        return client.describe_collection(collection_name=collection_name)

    async def collection_create_service(self, dto: CollectionRenameDto):
        name = dto.name
        already_exist = client.has_collection(collection_name=name)
        if already_exist:
            return "Collection already exists"
        schema = Schemas().schema
        client.create_collection(collection_name=name, schema=schema)
        return client.describe_collection(collection_name=name)

    async def collection_rename_service(self, dto: CollectionRenameDto):
        client.rename_collection(
            old_name=dto.name, new_name=dto.name, target_db=dto.target_db
        )
        return f"Rename from {dto.old_name} to {dto.new_name} in {dto.target_db} OK"

    async def collection_delete_service(self, collection_name: str):
        client.drop_collection(collection_name=collection_name)
        return f"Deleete {collection_name} OK"

    async def collection_reset_service(self):
        collections = await self.collection_get_all_service()
        for collection_name in collections:
            client.drop_collection(collection_name=collection_name)
        return "Reset OK"


class EmbeddingService:
    async def document_query_service(self, dto: DocumentQueryServiceDto):
        collection_name = dto.collection_name
        filter_field = dto.filter_field
        output_fields = dto.output_fields
        timeout = dto.timeout
        ids = dto.ids
        partition_names = dto.partition_names
        if not client.has_collection(collection_name=collection_name):
            raise HTTPException(status_code=404, detail="Collection not found")
        client.load_collection(collection_name=collection_name)
        res = client.search(
            collection_name=collection_name,
            data=[embedding_function.embed_query("who am i")],
            # filter=filter_field,
            # output_fields=output_fields,
            # timeout=timeout,
            # ids=ids,
            # partition_names=partition_names,
            limit=10,
        )
        client.release_collection(collection_name=collection_name)
        return res

    async def document_upload_service(
        self, collection_name: str, file: UploadFile, database: str
    ):
        doc_dir = os.getenv("DOC_ADDR")
        Path(doc_dir).mkdir(parents=True, exist_ok=True)
        tmp_path = Path(doc_dir) / file.filename

        try:
            contents = await file.read()
            with open(tmp_path, "wb") as f:
                f.write(contents)

            chunks = process_documents(is_multiple=False, file_path=str(tmp_path))
            embeddings = embedding_function.embed_documents(
                [chunk.page_content for chunk in chunks]
            )
            data = []
            for text, embedding in zip(chunks, embeddings):
                data.append(
                    {
                        "text": text.page_content,
                        "embedding": [float(x) for x in embedding],
                        "source": str(tmp_path),
                    }
                )
            client.insert(collection_name=collection_name, data=data)
            return client.get_collection_stats(collection_name=collection_name)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
        finally:
            if tmp_path.exists():
                os.remove(tmp_path)
