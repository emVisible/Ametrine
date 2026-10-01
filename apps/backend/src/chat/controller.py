from json import dumps, loads

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from src.client import TaskType, get_redis
from src.config import max_model_len
from src.llm.prompt import (
    compose_system_prompt,
    system_prompt_llm,
    system_prompt_rag,
)
from src.llm.service import LLMService, get_llm_service
from src.llm.streaming import aiter_sync, inference_slot
from src.middleware.logger import config_logger
from src.middleware.tags import ControllerTag
from src.user.auth.service import get_current_user
from src.user.permissions import PermissionService, get_permission_service
from src.user.quota import enforce_quota
from src.vector.documents.service import DocumentService, get_document_service

from .dto import ChatRequest, ChatResponse
from .history import ChatHistoryService, get_chat_history_service

route_chat = APIRouter(prefix="/chat", tags=[ControllerTag.chat])


def _error_event(exc: Exception) -> str:
    """流式失败时给客户端的一句话，完整堆栈只进 ametrine.log。

    原来这里是 `message=str(exc)`，而异常文本会经 SSE 落到浏览器界面上：
    psycopg / httpx / transformers 的报错里常见连接串、绝对路径与模型目录。
    类型名留着是有意为之——它足够让人判断「是模型没装还是数据库断了」，而不泄露地址。
    """
    config_logger.error(
        "chat stream failed: %s: %s", type(exc).__name__, exc, exc_info=True
    )
    return _event("error", message=f"生成中断：{type(exc).__name__}")


def _event(event_type: str, **payload):
    data = {"type": event_type, **payload}
    return f"data: {dumps(data, ensure_ascii=False)}\n\n"


def _chunk_content(chunk: dict) -> str:
    delta = chunk["choices"][0].get("delta") or {}
    return delta.get("content") or ""


async def _stream_llm(
    dto: ChatRequest,
    service: LLMService,
    personal_prompt=None,
    redis_client=None,
    user_id=None,
):
    try:
        messages = [
            {
                "role": "system",
                "content": compose_system_prompt(system_prompt_llm, personal_prompt),
            },
            *dto.chat_history,
            {"role": "user", "content": dto.message},
        ]
        # 名额覆盖整个消费循环（这条路径原本就是对的）；换成 inference_slot 是为了
        # 让「全局并发 + 单用户并发」只有一份实现，而不是两条路由各写一套语义。
        async with inference_slot(TaskType.LLM, redis_client, user_id):
            res = service.llm_model.chat(
                messages=messages,
                generate_config={"stream": True, "max_tokens": max_model_len},
            )
            async for chunk in aiter_sync(res):
                content = _chunk_content(chunk)
                if content:
                    yield _event("token", content=content)
                if chunk["choices"][0].get("finish_reason") == "stop":
                    break
        yield _event("done", conversation_id=dto.conversation_id)
    except Exception as exc:
        yield _error_event(exc)


async def _stream_rag(
    dto: ChatRequest,
    document_service: DocumentService,
    service: LLMService,
    personal_prompt=None,
    redis_client=None,
    user_id=None,
):
    try:
        rag = dto.rag
        database_name = rag.database_name if rag else "default"
        collection_name = rag.collection_name if rag else "default"
        context = await document_service.document_query_service(
            database_name=database_name,
            collection_name=collection_name,
            data=dto.message,
        )
        output = await service.rerank(
            question=dto.message,
            context=context,
            collection_name=collection_name,
        )
        prompt = service.create_user_prompt(question=dto.message, context=output)
        references = await service.parse_references(output)
        yield _event("reference", data=references)

        messages = [
            {
                "role": "system",
                "content": compose_system_prompt(system_prompt_rag, personal_prompt),
            },
            *dto.chat_history,
            {"role": "user", "content": prompt},
        ]
        async with inference_slot(TaskType.RAG, redis_client, user_id):
            res = service.llm_model.chat(
                messages=messages,
                generate_config={"stream": True, "max_tokens": max_model_len},
            )
            async for chunk in aiter_sync(res):
                content = _chunk_content(chunk)
                if content:
                    yield _event("token", content=content)
                if chunk["choices"][0].get("finish_reason") == "stop":
                    break
        yield _event("done", conversation_id=dto.conversation_id)
    except Exception as exc:
        yield _error_event(exc)





async def _collect_stream(stream):
    content = ""
    references = []
    async for raw in stream:
        if not raw.startswith("data: "):
            continue
        event = raw.removeprefix("data: ").strip()
        payload = loads(event)
        if payload["type"] == "token":
            content += payload.get("content", "")
        elif payload["type"] == "reference":
            references = payload.get("data", [])
        elif payload["type"] == "error":
            raise RuntimeError(payload.get("message", "Chat stream failed"))
    return ChatResponse(content=content, references=references)


async def _persisting_stream(
    stream,
    history_service: ChatHistoryService,
    dto: ChatRequest,
    conversation_id,
):
    content = ""
    references = None
    failed = False
    async for raw in stream:
        if raw.startswith("data: "):
            payload = loads(raw.removeprefix("data: ").strip())
            if payload["type"] == "token":
                content += payload.get("content", "")
            elif payload["type"] == "reference":
                # RAG 的引用现在才真正落库。以前这条路径只写 {"mode": ...}，
                # 于是「有依据的回答」在服务器上一律退化成一段无从核对的文本。
                references = payload.get("data") or []
            elif payload["type"] == "error":
                failed = True
            elif payload["type"] == "tool_call":
                tool_data = payload.get("data") or {}
                await history_service.create_tool_call(
                    conversation_id=conversation_id,
                    tool_name=tool_data.get("tool"),
                    tool_input=tool_data.get("tool_input"),
                    meta={"raw": tool_data},
                )
        yield raw

    if content or failed:
        meta = {"mode": dto.mode}
        if references is not None:
            meta["references"] = references
        await history_service.create_message(
            conversation_id=conversation_id,
            role="assistant",
            content=content,
            # 只有这里明确知道的失败才传；其余交给服务端按引用是否为空推导
            status="failed" if failed else None,
            meta=meta,
        )


@route_chat.post("", summary="[Chat] 统一对话入口")
async def chat(
    dto: ChatRequest,
    # 鉴权依赖要排在模型依赖前面：FastAPI 按签名顺序解析，
    # 而 get_llm_service → get_rerank_model 会去打 Xinference，本机没模型时直接抛 500，
    # 于是「没登录」的请求看到的是 500 而不是 401（实测就是这样）。
    # enforce_quota 自带 current_user 依赖，放最前同时满足「先鉴权」和「先限流」。
    # 这条路由原先完全没有配额：到限额的人换个入口就能继续烧算力。
    _quota=Depends(enforce_quota),
    current_user=Depends(get_current_user),
    llm_service: LLMService = Depends(get_llm_service),
    document_service: DocumentService = Depends(get_document_service),
    history_service: ChatHistoryService = Depends(get_chat_history_service),
    perm_service: PermissionService = Depends(get_permission_service),
    redis_client=Depends(get_redis),
):
    # 库级读权限要在任何写入之前判：/api/llm/rag 早就有 require_read_database，
    # 而这条统一入口没有 —— 任何登录用户都能拿它查任意知识库，
    # 并且被拒时连会话与用户消息都已经落库了。
    if dto.mode == "rag":
        rag = dto.rag
        await perm_service.require_read_database(
            current_user.id, rag.database_name if rag else "default"
        )

    try:
        conversation = await history_service.ensure_conversation(
            conversation_id=dto.conversation_id,
            mode=dto.mode,
            title=dto.message[:40],
            user_id=current_user.id,
        )
    except PermissionError:
        # 报了一个属于别人的 conversation_id：拒不写入，也不回显对方内容
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="该会话不属于当前用户"
        )
    dto.conversation_id = str(conversation.id)
    await history_service.create_message(
        conversation_id=conversation.id,
        role="user",
        content=dto.message,
        meta={"mode": dto.mode},
    )

    # 只认「库里这个账号写好的偏好」。请求体里的 system_prompt 字段已从 DTO 删除：
    # 让请求方随意覆盖系统提示，等于把 RAG 的引用约束交给调用方关掉。
    if dto.mode == "rag":
        stream = _stream_rag(
            dto,
            document_service=document_service,
            service=llm_service,
            personal_prompt=current_user.system_prompt,
            redis_client=redis_client,
            user_id=current_user.id,
        )
    else:
        stream = _stream_llm(
            dto,
            service=llm_service,
            personal_prompt=current_user.system_prompt,
            redis_client=redis_client,
            user_id=current_user.id,
        )

    if not dto.options.stream:
        response = await _collect_stream(stream)
        response.conversation_id = str(conversation.id)
        meta = {"mode": dto.mode}
        if dto.mode == "rag":
            meta["references"] = response.references
        await history_service.create_message(
            conversation_id=conversation.id,
            role="assistant",
            content=response.content,
            meta=meta,
        )
        return response

    return StreamingResponse(
        content=_persisting_stream(
            stream=stream,
            history_service=history_service,
            dto=dto,
            conversation_id=conversation.id,
        ),
        media_type="text/event-stream",
        status_code=200,
    )
