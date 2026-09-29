from fastapi import Depends, HTTPException
from pymilvus import MilvusClient
from src.client import get_milvus_service
from src.llm.service import LLMService, get_llm_service
from src.relation.service import RelationService, get_relation_service
from src.utils.other import use_vector_database


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
