from os import getenv
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, HTTPException, UploadFile
from pymilvus import MilvusClient
from src.client import get_milvus_service
from src.llm.service import LLMService, get_llm_service
from src.relation.service import RelationService, get_relation_service
from src.utils import use_vector_database

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
        self, database_name: str, collection_name: str, data: str
    ):
        if not self.milvus_service.has_collection(collection_name=collection_name):
            raise HTTPException(status_code=404, detail="Collection not found")
        self.milvus_service.load_collection(collection_name=collection_name)
        res = self.milvus_service.search(
            collection_name=collection_name,
            data=[self.llm_service.embedding_model.embed_query(data)],
            output_fields=["doc_id", "chunk_id"],
            timeout=30,
            limit=10,
        )
        self.milvus_service.release_collection(collection_name=collection_name)
        return res[0]

    @use_vector_database()
    async def document_upload_service(
        self, collection_name: str, file: UploadFile, database_name: str
    ):
        doc_dir = getenv("DOC_ADDR")
        Path(doc_dir).mkdir(parents=True, exist_ok=True)
        tmp_path = Path(doc_dir) / file.filename

        try:
            contents = await file.read()
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
            uuid = uuid4()
            await self.relation_service.documentService.document_create_service(
                id=uuid,
                title=file.filename,
                uploader="admin",
                collection_id=collection.id,
                meta={"source": chunks[0].metadata["source"]},
            )
            data = []
            for text, embedding in zip(chunks, embeddings):
                chunk = (
                    await self.relation_service.documentService.chunk_create_service(
                        doc_id=uuid,
                        content=text.page_content,
                    )
                )
                data.append(
                    {
                        "embedding": [float(x) for x in embedding],
                        "doc_id": str(uuid),
                        "chunk_id": chunk.id,
                    }
                )
            self.milvus_service.insert(collection_name=collection_name, data=data)
            return self.milvus_service.get_collection_stats(
                collection_name=collection_name
            )
        except Exception as e:
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
