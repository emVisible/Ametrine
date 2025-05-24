from asyncio import Lock, sleep
from json import dumps, loads
from uuid import uuid4

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from src.client import llm_model, redis_client
from starlette.responses import StreamingResponse

from ..config import max_model_len
from ..llm.dto.chat import RAGChatDto
from ..logger import Tags, log
from ..prompt import system_prompt_llm, system_prompt_rag
from ..vector.documents.service import DocumentService, get_document_service
from .dto.chat import LLMChatDto
from .service import LLMService, get_llm_service

route_llm = APIRouter(prefix="/llm", tags=[Tags.llm])
model_lock = Lock()


async def streaming_response_iterator(res):
    for chunk in res:
        cache = dumps(chunk["choices"][0]["delta"]["content"]) + "\n"
        if cache:
            yield cache
        if chunk["choices"][0].get("finish_reason") == "stop":
            break
        await sleep(0)


@route_llm.post("/chat", summary="[LLM] 基础对话, 无检索")
@log("Chat")
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


@route_llm.post("/rag", summary="[RAG] 检索对话")
@log("RAG")
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
    references = await llm_service.parse_references(output)
    session_id = str(uuid4())
    redis_client.setex(f"chat_ref:{session_id}", 600, dumps(references))
    if len(prompt) > int(max_model_len):
        prompt = prompt[:max_model_len]
    async with model_lock:
        res = llm_model.chat(
            messages=[
                {"role": "system", "content": system_prompt_rag},
                *chat_history,
                {"role": "user", "content": prompt},
            ],
            generate_config={
                "stream": True,
                "max_tokens": max_model_len,
            },
        )
    response = StreamingResponse(
        content=streaming_response_iterator(res),
        media_type="text/event-stream",
        status_code=200,
    )
    response.headers["X-Session-ID"] = session_id
    return response


@route_llm.get("/references")
async def get_references(session_id: str):
    ref_json = redis_client.get(f"chat_ref:{session_id}")
    references = loads(ref_json)
    return references
