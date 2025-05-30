from asyncio import get_running_loop, sleep
from json import dumps

from fastapi import Depends
from src.client import (get_embedding_model, get_llm_model, get_rerank_model,
                        get_tokenizer)
from src.config import k, max_model_len, min_relevance_score, p
from src.relation.service import RelationService, get_relation_service

from .dto.rearank import RerankResult
from .prompt import user_prompt


class LLMService:
    def __init__(
        self,
        llm_model,
        embedding_model,
        rerank_model,
        relation_service: RelationService,
    ):
        self.llm_model = llm_model
        self.embedding_model = embedding_model
        self.rerank_model = rerank_model
        self.relation_service = relation_service

    async def streaming_response_iterator(self, res):
        for chunk in res:
            cache = dumps(chunk["choices"][0]["delta"]["content"]) + "\n"
            if cache:
                yield cache
            if chunk["choices"][0].get("finish_reason") == "stop":
                break
            await sleep(0)

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
        res = self.unify_filter(data=reranked_data, question=question)
        return res

    async def rerank_loop(self, document: list[str], question: str):
        texts = [item["text"] for item in document]
        text_to_meta = {item["text"]: item["metadata"] for item in document}

        loop = get_running_loop()
        res: RerankResult = await loop.run_in_executor(
            None, self.rerank_model.rerank, texts, question, k, None, True
        )
        for item in res["results"]:
            item["metadata"] = text_to_meta.get(item["document"]["text"])
        return res

    def unify_filter(self, data: list[dict], question: str):
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

    async def parse_references(self, output: list[dict]):
        if type(output) == list:
          return []
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

    def create_user_prompt(self, question: str, context: list[dict]):
        reference = (
            "\n".join([item["text"] for item in context if "text" in item])
            if context
            else "(无参考信息, 请按提示要求返回)"
        )
        return self.truncate_prompt(user_prompt(question=question, reference=reference))

    def truncate_prompt(self, prompt: str) -> str:
        tokenizer = get_tokenizer()
        tokens = tokenizer.encode(prompt)
        if len(tokens) > max_model_len:
            tokens = tokens[:max_model_len]
            prompt = tokenizer.decode(tokens, clean_up_tokenization_spaces=True)
        return prompt


def get_llm_service(
    llm_model=Depends(get_llm_model),
    embedding_model=Depends(get_embedding_model),
    rerank_model=Depends(get_rerank_model),
    relation_service=Depends(get_relation_service),
) -> LLMService:
    return LLMService(
        llm_model=llm_model,
        embedding_model=embedding_model,
        rerank_model=rerank_model,
        relation_service=relation_service,
    )
