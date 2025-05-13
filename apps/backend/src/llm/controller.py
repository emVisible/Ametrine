from asyncio import Lock, sleep
from json import dumps

from fastapi import APIRouter, status, Depends
from fastapi.responses import StreamingResponse
from starlette.responses import StreamingResponse

from src.middleware import llm_model

from ..prompt import system_prompt_llm
from ..logger import Tags
from ..config import max_model_len
from ..llm.dto.chat import RAGChatDto
from ..prompt import system_prompt_llm, system_prompt_rag
from ..logger import Tags
from ..llm import service
from ..vector.documents.service import get_document_service, DocumentService
from .dto.chat import LLMChatDto

route_llm = APIRouter(prefix="/llm")
model_lock = Lock()


async def streaming_response_iterator(res):
    for chunk in res:
        cache = dumps(chunk["choices"][0]["delta"]["content"]) + "\n"
        if cache:
            yield cache
        await sleep(0)


@route_llm.post(
    "/chat",
    summary="[LLM] 基础对话, 无检索",
    status_code=status.HTTP_200_OK,
    tags=[Tags.llm],
)
async def chat(dto: LLMChatDto):
    prompt = dto.prompt
    chat_history = dto.chat_history
    messages = [
        {"role": "system", "content": system_prompt_llm},
        {"role": "user", "content": prompt},
        *chat_history,
    ]
    async with model_lock:
        res = llm_model.chat(
            messages=messages,
            generate_config={
                "stream": True,
            },
        )

    return StreamingResponse(
        content=streaming_response_iterator(res),
        media_type="text/event-stream",
        status_code=200,
    )


@route_llm.post(
    "/rag",
    summary="[RAG] 检索对话",
    status_code=status.HTTP_200_OK,
    tags=[Tags.llm],
)
async def search(
    dto: RAGChatDto, document_service: DocumentService = Depends(get_document_service)
):
    raw_prompt = dto.prompt
    chat_history = dto.chat_history
    database_name = dto.database_name
    collection_name = dto.collection_name
    context = await document_service.document_query_service(
        database_name=database_name, collection_name=collection_name, data=raw_prompt
    )
    context = await service.rerank(question=raw_prompt, context=context)
    prompt = await service.create_system_static_prompt(
        question=raw_prompt, context=context
    )
    if len(prompt) > int(max_model_len):
        prompt = prompt[:max_model_len]
    async with model_lock:
        res = llm_model.chat(
            messages=[
                {"role": "system", "content": system_prompt_rag},
                {"role": "user", "content": prompt},
                *chat_history,
            ],
            generate_config={
                "stream": True,
                "max_tokens": 30000,
            },
        )
    return StreamingResponse(
        content=streaming_response_iterator(res),
        media_type="text/event-stream",
        status_code=200,
    )
