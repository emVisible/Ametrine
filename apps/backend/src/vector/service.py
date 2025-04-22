from fastapi import File, UploadFile
from src.base.models import Collection
from pymilvus import MilvusClient
from pymilvus import Collection, DataType
from .loader import load_document
import os
from src.base.models import Collection
from pymilvus import Collection, CollectionSchema, FieldSchema, DataType, connections
from langchain_community.embeddings import XinferenceEmbeddings
import shutil
from pathlib import Path
from ..config import (
    chunk_overlap,
    chunk_size,
    xinference_addr,
    xinference_embedding_model_id,
)
import shutil
from pathlib import Path
from fastapi import File, HTTPException, UploadFile
from langchain_community.embeddings import XinferenceEmbeddings
from pymilvus import Collection, CollectionSchema, FieldSchema, DataType, connections


from ..config import (
    chunk_overlap,
    chunk_size,
    db_addr,
    doc_addr,
    xinference_addr,
    xinference_embedding_model_id,
)
from langchain.text_splitter import RecursiveCharacterTextSplitter
from src.vector.dto.collection import (
    CollectionCreateDto,
    DocumentQueryServiceDto,
    CollectionGetDto,
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


async def collection_get_all_service():
    return client.list_collections()


async def collection_get_service(dto: CollectionGetDto):
    name = dto.name
    return client.describe_collection(collection_name=name)


async def collection_create_service(dto: CollectionCreateDto):
    name = dto.name
    # tenant_name = dto.tenant_name
    # database_name = dto.database_name
    # metadata = dto.metadata
    already_exist = client.has_collection(collection_name=name)
    if already_exist:
        return "Collection already exists"
    schema = Schemas().schema
    client.create_collection(collection_name=name, schema=schema)
    return client.describe_collection(collection_name=name)


async def document_query_service(dto: DocumentQueryServiceDto):
    collection_name = dto.collection_name
    filter_field = dto.filter
    output_fields = dto.output_fields
    timeout = dto.timeout
    ids = dto.ids
    partition_names = dto.partition_names
    if not client.has_collection(collection_name=collection_name):
        raise HTTPException(status_code=404, detail="Collection not found")
    return client.query(
        collection_name=collection_name,
        filter=filter_field,
        output_fields=output_fields,
        timeout=timeout,
        ids=ids,
        partition_names=partition_names,
        limit=10,
    )


async def collection_reset_service():
    collections = await collection_get_all_service()
    for collection_name in collections:
        client.drop_collection(collection_name=collection_name)
    return "Reset OK"


async def document_upload_service(
    collection_name: str, file: UploadFile, database: str
):
    doc_dir = os.getenv("DOC_ADDR")
    Path(doc_dir).mkdir(parents=True, exist_ok=True)
    tmp_path = Path(doc_dir) / file.filename
    embedding_function = XinferenceEmbeddings(
        server_url=xinference_addr, model_uid=xinference_embedding_model_id
    )

    try:
        contents = await file.read()
        with open(tmp_path, "wb") as f:
            f.write(contents)

        documents = load_document(str(tmp_path))
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=chunk_size, chunk_overlap=chunk_overlap
        )
        texts = text_splitter.split_documents(documents)

        embeddings = embedding_function.embed_documents(
            [doc.page_content for doc in texts]
        )

        # document_ids = list(range(len(texts)))
        # texts_to_insert = [doc.page_content for doc in texts]
        # vectors_to_insert = embeddings
        data = []
        for text, embedding in zip(texts, embeddings):
            data.append(
                {
                    "id": None,  # 使用auto_id
                    "text": text.page_content,
                    "vector": [float(x) for x in embedding],  # 确保是float列表
                    "embedding": [float(x) for x in embedding],  # 确保是float列表
                    "source": str(tmp_path),
                    "document": text.page_content,
                    "metadata": {},
                }
            )
        client.insert(collection_name=collection_name, data=data)
        return client.get_collection_stats(collection_name=collection_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path.exists():
            os.remove(tmp_path)
