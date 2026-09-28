from asyncio import Semaphore
from json import dumps, loads
from operator import attrgetter
from uuid import uuid4

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from src.client import TaskType, get_redis, get_semaphore
from src.config import max_model_len
from src.llm.dto.chat import RAGChat
from src.middleware.logger import log
from src.middleware.tags import ControllerTag
from src.vector.documents.service import DocumentService, get_document_service
from src.user.permissions import PermissionService, get_permission_service
from src.user.auth.service import get_current_user

from .dto.chat import LLMChat
from .prompt import compose_system_prompt, system_prompt_llm, system_prompt_rag
from .service import LLMService, get_llm_service

route_llm = APIRouter(prefix="/llm", tags=[ControllerTag.llm])


def ref_key(user_id: int, session_id: str) -> str:
    return f"chat_ref:{user_id}:{session_id}"


@route_llm.post("/chat", summary="[LLM] 基础对话")
@log("Chat")
async def chat(
    dto: LLMChat,
    # 前端真正用的是 /api/llm/chat（/api/chat 那个统一入口暂时没人调），
    # 而它原本是这四个端点里唯一没有鉴权的：任何人不带凭证就能占信号量、烧推理算力。
    # /api/llm/rag 早就有 current_user，这里补齐同一标准。
    # 依赖必须排在 service 之前：service 会去打 Xinference，本机没模型时先炸 500，
    # 「没登录」的请求就看不到 401（实测踩过）。
    current_user=Depends(get_current_user),
    service: LLMService = Depends(get_llm_service),
):
    prompt, chat_history = attrgetter("prompt", "chat_history")(dto)

    messages = [
        {
            "role": "system",
            "content": compose_system_prompt(
                system_prompt_llm, current_user.system_prompt
            ),
        }
    ]
    messages.extend(chat_history)
    messages.append({"role": "user", "content": prompt})
    async with get_semaphore(TaskType.LLM):
        res = service.llm_model.chat(
            messages=messages,
            generate_config={"stream": True, "max_tokens": max_model_len},
        )
    return StreamingResponse(
        content=service.stream_by_token(res),
        media_type="text/event-stream",
        status_code=200,
    )


@route_llm.post("/rag", summary="[RAG] 检索对话")
@log("RAG")
async def search(
    dto: RAGChat,
    # current_user 必须排在 document_service / service 之前：后面的依赖会真去打
    # Milvus 与 Xinference，本机没就绪时先炸 500，未登录的请求就永远看不到 401。
    current_user=Depends(get_current_user),
    document_service: DocumentService = Depends(get_document_service),
    service: LLMService = Depends(get_llm_service),
    redis_client=Depends(get_redis),
    perm_service: PermissionService = Depends(get_permission_service),
):
    raw_prompt, chat_history, database_name, collection_name = attrgetter(
        "prompt", "chat_history", "database_name", "collection_name"
    )(dto)
    await perm_service.require_read_database(current_user.id, database_name)
    context = await document_service.document_query_service(
        database_name=database_name, collection_name=collection_name, data=raw_prompt
    )
    output = await service.rerank(
        question=raw_prompt, context=context, collection_name=collection_name
    )
    prompt = service.create_user_prompt(question=raw_prompt, context=output)
    references = await service.parse_references(output)
    session_id = str(uuid4())
    # 键里带 user_id：引用内容含知识库文档标题与来源，只有发起检索的人能取回。
    redis_client.setex(ref_key(current_user.id, session_id), 600, dumps(references))

    async with get_semaphore(TaskType.RAG):
        res = service.llm_model.chat(
            messages=[
                {
                    "role": "system",
                    "content": compose_system_prompt(
                        system_prompt_rag, current_user.system_prompt
                    ),
                },
                *chat_history,
                {"role": "user", "content": prompt},
            ],
            generate_config={
                "stream": True,
                "max_tokens": max_model_len,
            },
        )
    response = StreamingResponse(
        content=service.stream_by_token(res),
        media_type="text/event-stream",
        status_code=200,
    )
    response.headers["X-Session-ID"] = session_id
    return response


@route_llm.get("/references", summary="[RAG] 取回引用来源")
async def get_references(
    session_id: str,
    current_user=Depends(get_current_user),
    redis_client=Depends(get_redis),
):
    # 引用只在 600 秒 TTL 内可取，过期是这条链路的正常结局，不是异常：
    # 原先 loads(None) 直接把过期/未知 session 炸成 500（实测踩过）。
    # 前端拿到非数组会把「无引用」判定弄错，所以这里始终返回数组。
    ref_json = redis_client.get(ref_key(current_user.id, session_id))
    if not ref_json:
        return []
    return loads(ref_json)
