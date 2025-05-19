from os import getenv
from pathlib import Path
from uuid import uuid4

from fastapi import Depends, HTTPException, UploadFile
from pymilvus import MilvusClient
from src.relation.service import RelationService, get_relation
from src.utils import use_database_before

from ...middleware import embedding_function
from ..service import get_milvus_service
from .loader import process_documents


class DocumentService:
    def __init__(
        self,
        client: MilvusClient = Depends(get_milvus_service),
        relation_service: RelationService = Depends(get_relation),
    ):
        self.client = client
        self.relation_service = relation_service

    @use_database_before()
    async def document_query_service(
        self, database_name: str, collection_name: str, data: str
    ):
        if not self.client.has_collection(collection_name=collection_name):
            raise HTTPException(status_code=404, detail="Collection not found")
        self.client.load_collection(collection_name=collection_name)
        res = self.client.search(
            collection_name=collection_name,
            data=[embedding_function.embed_query(data)],
            output_fields=["doc_id", "chunk_id"],
            # filter=filter_field,
            # output_fields=output_fields,
            # timeout=timeout,
            # ids=ids,
            # partition_names=partition_names,
            limit=10,
        )
        self.client.release_collection(collection_name=collection_name)
        return res[0]

    @use_database_before()
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
            embeddings = embedding_function.embed_documents(
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
            self.client.insert(collection_name=collection_name, data=data)
            return self.client.get_collection_stats(collection_name=collection_name)
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
        # finally:
        #     if tmp_path.exists():
        #         os.remove(tmp_path)


def get_document_service(
    milvus_service: MilvusClient = Depends(get_milvus_service),
    relation_service: RelationService = Depends(get_relation),
) -> DocumentService:
    return DocumentService(client=milvus_service, relation_service=relation_service)
