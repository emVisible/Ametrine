from asyncio import get_running_loop

from src.middleware import rerank_model
from ..config import k, min_relevance_score
from .dto.rearank import RerankResultSchemas


async def unify_filter(data: list[dict], question: str):
    res = []
    filter_data = [
        sorted(part["results"], key=lambda x: x["relevance_score"]) for part in data
    ]
    for document in filter_data:
        texts = [
            item["document"]["text"]
            for item in document
            if item["relevance_score"] > min_relevance_score
            # if item["relevance_score"] > min_relevance_score
        ]
        res.append(texts[0])
    if len(res) > 0:
        return res[0]
    return False


async def rerank_loop(document: list[str], question: str):
    loop = get_running_loop()
    res: RerankResultSchemas = await loop.run_in_executor(
        None, rerank_model.rerank, document, question, k, None, True
    )
    return res


async def rerank(question: str, context: list[dict]) -> str:
    documents = [item["entity"]["text"] for item in context]
    reranked_data = []
    for document in documents:
        part_res = await rerank_loop(document=[document], question=question)
        reranked_data.append(part_res)
    res = await unify_filter(data=reranked_data, question=question)
    return res


# 静态提示词拼接
async def create_system_static_prompt(question: str, context: str):
    return f"[需要处理的问题]:\n{question}\n[已知文档信息]:\n{context or '(无参考信息, 请按提示要求返回)'}"
