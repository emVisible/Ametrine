from asyncio import Semaphore
from json import dumps, loads
from operator import attrgetter
from uuid import uuid4

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from src.client import get_redis, get_semaphore, TaskType
from src.config import max_model_len
from src.llm.dto.chat import RAGChat
from src.middleware.logger import log
from src.middleware.tags import ControllerTag
from src.vector.documents.service import DocumentService, get_document_service

from .dto.chat import LLMChat
from .prompt import system_prompt_llm, system_prompt_rag
from .service import LLMService, get_llm_service

route_llm = APIRouter(prefix="/llm", tags=[ControllerTag.llm])


@route_llm.post("/chat", summary="[LLM] 基础对话")
@log("Chat")
async def chat(dto: LLMChat, service: LLMService = Depends(get_llm_service)):
    prompt, chat_history = attrgetter("prompt", "chat_history")(dto)
    messages = [
        {"role": "system", "content": system_prompt_llm},
        *chat_history,
        {"role": "user", "content": prompt},
    ]
    async with get_semaphore(TaskType.LLM):
        res = service.llm_model.chat(
            messages=messages,
            generate_config={"stream": True, "max_tokens": max_model_len},
        )
    return StreamingResponse(
        content=service.streaming_response_iterator(res),
        media_type="text/event-stream",
        status_code=200,
    )


@route_llm.post("/rag", summary="[RAG] 检索对话")
@log("RAG")
async def search(
    dto: RAGChat,
    document_service: DocumentService = Depends(get_document_service),
    service: LLMService = Depends(get_llm_service),
    redis_client=Depends(get_redis),
):
    raw_prompt, chat_history, database_name, collection_name = attrgetter(
        "prompt", "chat_history", "database_name", "collection_name"
    )(dto)
    context = await document_service.document_query_service(
        database_name=database_name, collection_name=collection_name, data=raw_prompt
    )
    output = await service.rerank(
        question=raw_prompt, context=context, collection_name=collection_name
    )
    prompt = service.create_user_prompt(question=raw_prompt, context=output)
    references = await service.parse_references(output)
    session_id = str(uuid4())
    redis_client.setex(f"chat_ref:{session_id}", 600, dumps(references))
    async with get_semaphore(TaskType.RAG):
        res = service.llm_model.chat(
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
        content=service.streaming_response_iterator(res),
        media_type="text/event-stream",
        status_code=200,
    )
    response.headers["X-Session-ID"] = session_id
    return response


@route_llm.get("/references")
async def get_references(session_id: str, redis_client=Depends(get_redis)):
    ref_json = redis_client.get(f"chat_ref:{session_id}")
    references = loads(ref_json)
    return references
