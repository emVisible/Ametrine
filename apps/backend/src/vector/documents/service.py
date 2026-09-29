from hashlib import sha256
from os import getenv
from pathlib import Path
from time import time
from uuid import uuid4

from fastapi import Depends, HTTPException, UploadFile
from pymilvus import MilvusClient
from src.client import get_milvus_service
from src.config import xinference_embedding_model_id
from src.llm.service import LLMService, get_llm_service
from src.relation.service import RelationService, get_relation_service
from src.utils.other import use_vector_database

from .loader import process_documents


class DocumentService:
    def __init__(
        self,
        milvus_service: MilvusClient,
        relation_service: RelationService,
        llm_service: LLMService,
    ):
        self.milvus_service = milvus_service
        self.relation_service = relation_service
        self.llm_service = llm_service

    @use_vector_database()
    async def document_query_service(
        self, database_name: str, collection_name: str, data: str, limit: int = 10
    ):
        """向量检索。limit 由调用方给，原来写死 10。

        命中的每条是 {id, distance, entity{doc_id, chunk_id}}：
        distance 一直在结果里（它不是 output_field，是检索器附带的），
        所以「不重排、直接按向量距离取前 p 条」这条路是可行的 ——
        之前以为要先把 distance 加进 output_fields 才能做，是判断错了。
        """
        if not self.milvus_service.has_collection(collection_name=collection_name):
            raise HTTPException(status_code=404, detail="Collection not found")
        try:
            self.milvus_service.load_collection(collection_name=collection_name)
            res = self.milvus_service.search(
                collection_name=collection_name,
                data=[self.llm_service.embedding_model.embed_query(data)],
                output_fields=["doc_id", "chunk_id"],
                timeout=30,
                limit=limit,
            )
            return res[0]
        finally:
            self.milvus_service.release_collection(collection_name=collection_name)

    def _collection_fields(self, collection_name: str) -> set[str]:
        collection = self.milvus_service.describe_collection(
            collection_name=collection_name
        )
        return {field["name"] for field in collection.get("fields", [])}

    @use_vector_database()
    async def document_upload_service(
        self, collection_name: str, file: UploadFile, database_name: str
    ):
        doc_dir = getenv("DOC_ADDR")
        Path(doc_dir).mkdir(parents=True, exist_ok=True)
        safe_filename = Path(file.filename or "upload.bin").name
        tmp_path = Path(doc_dir) / f"{uuid4()}-{safe_filename}"
        document_id = uuid4()
        document_created = False

        try:
            contents = await file.read()
            digest = sha256(contents).hexdigest()
            with open(tmp_path, "wb") as f:
                f.write(contents)

            chunks = process_documents(is_multiple=False, file_path=str(tmp_path))
            embeddings = self.llm_service.embedding_model.embed_documents(
                [chunk.page_content for chunk in chunks]
            )
            collection = (
                await self.relation_service.collectionService.collection_get_service(
                    name=collection_name
                )
            )
            await self.relation_service.documentService.document_create_service(
                id=document_id,
                title=safe_filename,
                uploader="admin",
                collection_id=collection.id,
                meta={
                    "source": chunks[0].metadata["source"],
                    "stored_path": str(tmp_path),
                    "sha256": digest,
                    "index_status": "pending",
                    "embedding_model": xinference_embedding_model_id,
                },
            )
            document_created = True
            available_fields = self._collection_fields(collection_name=collection_name)
            created_at = int(time())
            data = []
            for text, embedding in zip(chunks, embeddings):
                chunk = (
                    await self.relation_service.documentService.chunk_create_service(
                        doc_id=document_id,
                        content=text.page_content,
                    )
                )
                item = {
                    "embedding": [float(x) for x in embedding],
                    "doc_id": str(document_id),
                    "chunk_id": chunk.id,
                }
                if "source_type" in available_fields:
                    item["source_type"] = "document"
                if "embedding_model" in available_fields:
                    item["embedding_model"] = xinference_embedding_model_id
                if "created_at" in available_fields:
                    item["created_at"] = created_at
                data.append(item)
            self.milvus_service.insert(collection_name=collection_name, data=data)
            await self.relation_service.documentService.document_update_meta_service(
                document_id=document_id,
                meta={"index_status": "indexed", "chunk_count": len(chunks)},
            )
            return self.milvus_service.get_collection_stats(
                collection_name=collection_name
            )
        except Exception as e:
            if document_created:
                await self.relation_service.documentService.document_update_meta_service(
                    document_id=document_id,
                    meta={"index_status": "failed", "index_error": str(e)},
                )
            raise HTTPException(status_code=500, detail=str(e))
        # finally:
        #     if tmp_path.exists():
        #         os.remove(tmp_path)


def get_document_service(
    milvus_service: MilvusClient = Depends(get_milvus_service),
    relation_service: RelationService = Depends(get_relation_service),
    llm_service: LLMService = Depends(get_llm_service),
) -> DocumentService:
    return DocumentService(
        milvus_service=milvus_service,
        relation_service=relation_service,
        llm_service=llm_service,
    )
