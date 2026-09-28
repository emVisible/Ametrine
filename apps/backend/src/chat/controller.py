from json import dumps, loads

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from src.client import TaskType, get_semaphore
from src.config import max_model_len
from src.llm.prompt import (
    compose_system_prompt,
    system_prompt_llm,
    system_prompt_rag,
)
from src.llm.service import LLMService, get_llm_service
from src.middleware.tags import ControllerTag
from src.user.auth.service import get_current_user
from src.vector.documents.service import DocumentService, get_document_service

from .dto import ChatRequest, ChatResponse
from .history import ChatHistoryService, get_chat_history_service

route_chat = APIRouter(prefix="/chat", tags=[ControllerTag.chat])


def _event(event_type: str, **payload):
    data = {"type": event_type, **payload}
    return f"data: {dumps(data, ensure_ascii=False)}\n\n"


def _chunk_content(chunk: dict) -> str:
    delta = chunk["choices"][0].get("delta") or {}
    return delta.get("content") or ""


async def _stream_llm(dto: ChatRequest, service: LLMService, personal_prompt=None):
    try:
        messages = [
            {
                "role": "system",
                "content": compose_system_prompt(system_prompt_llm, personal_prompt),
            },
            *dto.chat_history,
            {"role": "user", "content": dto.message},
        ]
        async with get_semaphore(TaskType.LLM):
            res = service.llm_model.chat(
                messages=messages,
                generate_config={"stream": True, "max_tokens": max_model_len},
            )
            for chunk in res:
                content = _chunk_content(chunk)
                if content:
                    yield _event("token", content=content)
                if chunk["choices"][0].get("finish_reason") == "stop":
                    break
        yield _event("done", conversation_id=dto.conversation_id)
    except Exception as exc:
        yield _event("error", message=str(exc))


async def _stream_rag(
    dto: ChatRequest,
    document_service: DocumentService,
    service: LLMService,
    personal_prompt=None,
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
        async with get_semaphore(TaskType.RAG):
            res = service.llm_model.chat(
                messages=messages,
                generate_config={"stream": True, "max_tokens": max_model_len},
            )
            for chunk in res:
                content = _chunk_content(chunk)
                if content:
                    yield _event("token", content=content)
                if chunk["choices"][0].get("finish_reason") == "stop":
                    break
        yield _event("done", conversation_id=dto.conversation_id)
    except Exception as exc:
        yield _event("error", message=str(exc))





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
    failed = False
    async for raw in stream:
        if raw.startswith("data: "):
            payload = loads(raw.removeprefix("data: ").strip())
            if payload["type"] == "token":
                content += payload.get("content", "")
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
        await history_service.create_message(
            conversation_id=conversation_id,
            role="assistant",
            content=content,
            status="failed" if failed else "done",
            meta={"mode": dto.mode},
        )


@route_chat.post("", summary="[Chat] 统一对话入口")
async def chat(
    dto: ChatRequest,
    # 鉴权依赖要排在模型依赖前面：FastAPI 按签名顺序解析，
    # 而 get_llm_service → get_rerank_model 会去打 Xinference，本机没模型时直接抛 500，
    # 于是「没登录」的请求看到的是 500 而不是 401（实测就是这样）。
    current_user=Depends(get_current_user),
    llm_service: LLMService = Depends(get_llm_service),
    document_service: DocumentService = Depends(get_document_service),
    history_service: ChatHistoryService = Depends(get_chat_history_service),
):
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

    # 只认「库里这个账号写好的偏好」。dto.system_prompt（客户端自带的同名字段）故意不采信：
    # 让请求方随意覆盖系统提示，等于把 RAG 的引用约束交给调用方关掉。
    if dto.mode == "rag":
        stream = _stream_rag(
            dto,
            document_service=document_service,
            service=llm_service,
            personal_prompt=current_user.system_prompt,
        )
    else:
        stream = _stream_llm(
            dto, service=llm_service, personal_prompt=current_user.system_prompt
        )

    if not dto.options.stream:
        response = await _collect_stream(stream)
        response.conversation_id = str(conversation.id)
        await history_service.create_message(
            conversation_id=conversation.id,
            role="assistant",
            content=response.content,
            meta={"mode": dto.mode},
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
