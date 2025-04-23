from asyncio import Lock, sleep
from json import dumps

from fastapi import APIRouter, status
from fastapi.responses import StreamingResponse
from starlette.responses import StreamingResponse

from src.xinference import llm_model

from ..prompt import system_prompt_llm
from ..utils import Tags
from .dto.chat import LLMChatDto
from ..config import max_model_len
from ..llm.dto.chat import RAGChatDto
from ..prompt import system_prompt_rag
from ..utils import Tags
from ..llm import service

route_llm = APIRouter(prefix="/llm")
model_lock = Lock()


@route_llm.post(
    "/chat",
    summary="[LLM] 基础对话, 无检索",
    status_code=status.HTTP_200_OK,
    tags=[Tags.llm],
)
async def chat(body: LLMChatDto):
    prompt = body.prompt
    chat_history = body.chat_history
    messages = [
        {"role": "system", "content": system_prompt_llm},
        {"role": "user", "content": prompt},
    ]

    # 通过XINFERENCE Client联通, 对LLM模型发送chat API
    async with model_lock:
        res = llm_model.chat(
            messages=messages,
            # chat_history=chat_history,
            generate_config={
                "stream": True,
            },
        )

    async def streaming_response_iterator():
        for chunk in res:
            cache = dumps(chunk["choices"][0]["delta"]["content"]) + "\n"
            if cache:
                yield cache
            await sleep(0)

    return StreamingResponse(
        content=streaming_response_iterator(),
        media_type="text/event-stream",
        status_code=200,
    )


@route_llm.post(
    "/rag",
    summary="[RAG] 检索对话",
    status_code=status.HTTP_200_OK,
    tags=[Tags.llm],
)
async def search(body: RAGChatDto):
    raw_prompt = body.prompt
    chat_history = body.chat_history
    collection_name = body.collection_name
    context = await service.similarity_search(
        question=raw_prompt, collection_name=collection_name
    )
    prompt = await service.create_system_static_prompt(
        question=raw_prompt, context=context
    )
    if len(prompt) > int(max_model_len):
        prompt = prompt[:max_model_len]
    async with model_lock:
        res = llm_model.chat(
            prompt=prompt,
            system_prompt=system_prompt_rag,
            chat_history=[],
            generate_config={
                "stream": True,
                "max_tokens": 4096,
            },
        )

    async def streaming_response_iterator():
        for chunk in res:
            cache = dumps(chunk["choices"][0]["delta"]["content"]) + "\n"
            if cache:
                yield cache
            await sleep(0)

    return StreamingResponse(
        content=streaming_response_iterator(),
        media_type="text/event-stream",
        status_code=200,
    )
