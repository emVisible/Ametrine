from asyncio import get_running_loop

from fastapi import Depends
from src.client import rerank_model
from src.relation.service import RelationService, get_relation

from ..config import k, min_relevance_score, p
from .dto.rearank import RerankResultSchemas


class LLMService:
    def __init__(self, relation_service: RelationService = Depends(get_relation)):
        self.relation_service = relation_service

    async def rerank(
        self, question: str, context: list[dict], collection_name: str
    ) -> list[dict]:
        reranked_data = []
        for item in context:
            doc_id, chunk_id = item["entity"]["doc_id"], item["entity"]["chunk_id"]
            chunks = await self.relation_service.documentService.chunk_get_by_document_service(
                doc_id=doc_id, chunk_id=chunk_id, accuracy=True
            )
            part_res = await self.rerank_loop(
                document=[
                    {
                        "text": chunk.content,
                        "metadata": {"doc_id": doc_id, "chunk_id": chunk_id},
                    }
                    for chunk in chunks
                ],
                question=question,
            )
            reranked_data.append(part_res)
        res = await self.unify_filter(data=reranked_data, question=question)
        return res

    async def rerank_loop(self, document: list[str], question: str):
        texts = [item["text"] for item in document]
        text_to_meta = {item["text"]: item["metadata"] for item in document}

        loop = get_running_loop()
        res: RerankResultSchemas = await loop.run_in_executor(
            None, rerank_model.rerank, texts, question, k, None, True
        )
        for item in res["results"]:
            item["metadata"] = text_to_meta.get(item["document"]["text"])
        return res

    async def unify_filter(self, data: list[dict], question: str):
        res = []
        filter_data = [part["results"] for part in data]
        for document in filter_data:
            doc = {}
            for chunk in document:
                if chunk["relevance_score"] < min_relevance_score:
                    continue
                doc["text"] = chunk["document"]["text"]
                doc["doc_id"] = chunk["metadata"]["doc_id"]
                doc["chunk_id"] = chunk["metadata"]["chunk_id"]

            res.append(doc) if doc else None
        if len(res) > 0:
            return res[:p]
        return "## No relevant documents found, please try to rephrase your question."

    async def create_system_static_prompt(self, question: str, context: list[dict]):
        full_text = (
            "\n".join([item["text"] for item in context if "text" in item])
            if context
            else "(无参考信息, 请按提示要求返回)"
        )
        return f"[需要处理的问题]:\n{question}\n[已知文档信息]:\n{full_text}"

    async def parse_references(self, output: list[dict]):
        references = []
        for item in output:
            doc_id = item.get("doc_id")
            document = (
                await self.relation_service.documentService.document_describe_service(
                    document_id=doc_id
                )
            )
            references.append(document)
        return references


def get_llm_service(relation_service=Depends(get_relation)) -> LLMService:
    return LLMService(relation_service=relation_service)
