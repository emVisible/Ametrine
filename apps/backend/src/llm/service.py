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

    def vector_rank(self, context: list[dict], limit: int = p) -> list[dict]:
        """不重排时按向量距离直接排序。

        距离不能套进 min_relevance_score：那个阈值是给 rerank 的 0..1 相关性分的用的，
        而 MILVUS_METRIC_TYPE=L2，距离越小越好、量纲也不同。
        所以这条路只取前 p 条，不做阈值过滤 —— 宁可少筛一层，
        也不要把两种分数混在同一个阈值下。
        """
        ranked = sorted(
            context, key=lambda hit: hit.get("distance", float("inf"))
        )[:limit]
        out = []
        for hit in ranked:
            entity = hit.get("entity") or {}
            out.append(
                {
                    "text": None,
                    "doc_id": entity.get("doc_id"),
                    "chunk_id": entity.get("chunk_id"),
                    "relevance_score": hit.get("distance"),
                    "score_kind": "l2_distance",
                }
            )
        return out

    async def hydrate_texts(self, ranked: list[dict]) -> list[dict]:
        """给向量排序路径补上正文，让 prompt 与引用跟重排路径同构。"""
        pairs = [(r["doc_id"], r["chunk_id"]) for r in ranked]
        chunks = await self.relation_service.documentService.chunk_get_many_service(pairs)
        by_key = {(str(c.doc_id), c.id): c.content for c in chunks}
        for r in ranked:
            r["text"] = by_key.get((str(r["doc_id"]), r["chunk_id"]))
        return [r for r in ranked if r["text"]]

    async def rerank(
        self, question: str, context: list[dict], collection_name: str
    ) -> list[dict]:
        """一次批量重排，替掉「每个向量命中各打一次重排模型」。

        旧写法对 context 里每一条命中各发一次 rerank，而每次只喂一个候选 ——
        给单个文档排序没有意义（它自己就是第一名），
        还把 N 次模型往返 + N 次取正文串在回答路径上。
        现在一次取回全部正文、一次让模型对整批打分，排序交给 unify_filter。
        """
        pairs = [
            (item["entity"]["doc_id"], item["entity"]["chunk_id"])
            for item in context
            if item.get("entity")
        ]
        if not pairs:
            return []
        chunks = await self.relation_service.documentService.chunk_get_many_service(pairs)
        if not chunks:
            return []
        document = [
            {"text": chunk.content, "doc_id": chunk.doc_id, "chunk_id": chunk.id}
            for chunk in chunks
        ]
        part_res = await self.rerank_loop(document=document, question=question)
        return self.unify_filter(data=[part_res], question=question)

    async def rerank_loop(self, document: list[dict], question: str):
        """整批交给重排模型，按**下标**回填元信息。

        旧实现用文本内容做 key 回填。单条时不会撞，一旦批量就是真 bug：
        两个内容相同的分块会在字典里互相覆盖，于是分数正确、doc_id/chunk_id 却张冠李戴，
        引用会指向另一份同名内容。服务端返回的 index 才是可靠键。
        """
        texts = [item["text"] for item in document]

        loop = get_running_loop()
        # k 传整批长度：先让模型把所有候选都排出来，截断交给 unify_filter 的 p，
        # 否则 K=5 会在打分阶段就把第 6 条之后的候选直接丢掉。
        res: RerankResult = await loop.run_in_executor(
            None,
            self.rerank_model.rerank,
            texts,
            question,
            max(k, len(texts)),
            None,
            True,
        )
        for item in res["results"]:
            idx = item.get("index")
            src = document[idx] if isinstance(idx, int) and 0 <= idx < len(document) else None
            item["metadata"] = (
                {"doc_id": src["doc_id"], "chunk_id": src["chunk_id"]} if src else {}
            )
        return res

    def unify_filter(
        self, data: list[dict], question: str, min_score: float | None = None
    ) -> list[dict]:
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
        threshold = min_relevance_score if min_score is None else min_score
        best: dict[tuple, dict] = {}
        for part in data:
            for chunk in part.get("results", []):
                score = chunk.get("relevance_score", 0)
                if score < threshold:
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
