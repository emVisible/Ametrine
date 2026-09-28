from asyncio import get_running_loop, sleep
from json import dumps
from typing import AsyncIterator

from fastapi import Depends
from src.client import (
    get_embedding_model,
    get_llm_model,
    get_rerank_model,
    get_tokenizer,
)
from src.config import k, max_model_len, min_relevance_score, p
from src.relation.service import RelationService, get_relation_service
from transformers import Qwen2Tokenizer

from .dto.rearank import RerankResult
from .prompt import user_prompt


class LLMService:
    def __init__(
        self,
        llm_model,
        embedding_model,
        rerank_model,
        relation_service: RelationService,
        tokenizer: Qwen2Tokenizer,
    ):
        self.llm_model = llm_model
        self.embedding_model = embedding_model
        self.rerank_model = rerank_model
        self.relation_service = relation_service
        self.tokenizer = tokenizer

    async def stream_by_token(self, res):
        for chunk in res:
            choices = chunk.get("choices") or [{}]
            first = choices[0]
            # OpenAI 兼容流里第一个 delta 常常只有 {"role":"assistant"}、工具调用帧整帧没有 content，
            # 原先直接索引 ["delta"]["content"]，碰到这种帧 KeyError 会把整条回答打断。
            # /api/chat 那侧早就是防御式取值（_chunk_content），这里对齐同一套语义。
            content = (first.get("delta") or {}).get("content")
            if content is not None:
                yield dumps(content) + "\n"
            if first.get("finish_reason") == "stop":
                break
            await sleep(0)


    async def stream_by_step(self, iterator: AsyncIterator):
        async for step in iterator:
            if "output" in step:
                event = dumps({"type": "text", "content": step["output"]}) + "\n"
                yield event
            elif "action" in step:
                action = step["action"]
                event = (
                    dumps(
                        {
                            "type": "tool_call",
                            "tool": action.tool,
                            "input": action.tool_input,
                        }
                    )
                    + "\n"
                )
                yield event
            elif "thought" in step:
                event = dumps({"type": "thought", "content": step["thought"]}) + "\n"
                yield event
        yield dumps({"type": "done"}) + "\n"

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

    def unify_filter(self, data: list[dict], question: str) -> list[dict]:
        """
        三个修正（都是会静默降低回答质量的）：

        1. 旧实现每个向量命中只留一个 doc 字典，并且在循环里反复覆盖 doc["text"] ——
           命中的是多块时，留下的是**最后一条**，也就是 rerank 降序里的最低分那块。
           这里按 (doc_id, chunk_id) 取最高分。
        2. 旧实现返回的 res 顺序就是向量检索顺序，`res[:p]` 截的是「先检索到的 p 条」，
           重排分数算完了却从没参与过排序。这里按 relevance_score 全局降序后再截 p 条。
        3. 无命中时旧实现返回一个字符串，而本函数签名与所有调用方都按 list[dict] 用：
           create_user_prompt 里 `if context` 对非空字符串为真，于是走
           `[item["text"] for item in context]` —— 遍历的是字符，全部被 "text" in item 过滤掉，
           参考信息变成空串，模型收到「没有参考」却没有任何提示。改为返回 []，
           让 create_user_prompt 的 else 分支给出明确的「无参考信息」文案。
        """
        best: dict[tuple, dict] = {}
        for part in data:
            for chunk in part.get("results", []):
                score = chunk.get("relevance_score", 0)
                if score < min_relevance_score:
                    continue
                metadata = chunk.get("metadata") or {}
                key = (metadata.get("doc_id"), metadata.get("chunk_id"))
                candidate = {
                    "text": chunk["document"]["text"],
                    "doc_id": metadata.get("doc_id"),
                    "chunk_id": metadata.get("chunk_id"),
                    "relevance_score": score,
                }
                current = best.get(key)
                if current is None or score > current["relevance_score"]:
                    best[key] = candidate

        ranked = sorted(best.values(), key=lambda item: item["relevance_score"], reverse=True)
        return ranked[:p]

    async def parse_references(self, output: list[dict]):
        if type(output) == str:
            return []
        references = []
        for item in output:
            doc_id = item.get("doc_id")
            document = (
                await self.relation_service.documentService.document_describe_service(
                    document_id=doc_id
                )
            )
            if document:
                document["relevance_score"] = item.get("relevance_score", 0)
                document["chunk_id"] = item.get("chunk_id")
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
        tokens = self.tokenizer.encode(prompt)
        if len(tokens) > max_model_len:
            tokens = tokens[:max_model_len]
            prompt = self.tokenizer.decode(tokens, clean_up_tokenization_spaces=True)
        return prompt


def get_llm_service(
    llm_model=Depends(get_llm_model),
    embedding_model=Depends(get_embedding_model),
    rerank_model=Depends(get_rerank_model),
    relation_service=Depends(get_relation_service),
    tokenizer=Depends(get_tokenizer),
) -> LLMService:
    return LLMService(
        llm_model=llm_model,
        embedding_model=embedding_model,
        rerank_model=rerank_model,
        relation_service=relation_service,
        tokenizer=tokenizer,
    )
