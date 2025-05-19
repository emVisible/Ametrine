from asyncio import Lock, sleep
from json import dumps

from fastapi import APIRouter, Depends, status
from fastapi.responses import StreamingResponse
from src.middleware import llm_model
from starlette.responses import StreamingResponse

from ..config import max_model_len
from ..llm.dto.chat import RAGChatDto
from ..logger import Tags
from ..prompt import system_prompt_llm, system_prompt_rag
from ..vector.documents.service import DocumentService, get_document_service
from .dto.chat import LLMChatDto
from .service import LLMService, get_llm_service

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
    dto: RAGChatDto,
    document_service: DocumentService = Depends(get_document_service),
    llm_service: LLMService = Depends(get_llm_service),
):
    raw_prompt = dto.prompt
    chat_history = dto.chat_history
    database_name = dto.database_name
    collection_name = dto.collection_name
    context = await document_service.document_query_service(
        database_name=database_name, collection_name=collection_name, data=raw_prompt
    )
    output = await llm_service.rerank(
        question=raw_prompt, context=context, collection_name=collection_name
    )
    prompt = await llm_service.create_system_static_prompt(
        question=raw_prompt, context=output
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
