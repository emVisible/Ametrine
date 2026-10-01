from json import loads
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from src.client import get_redis
from src.llm.telemetry import telemetry_key
from src.middleware.logger import config_logger
from src.middleware.tags import ControllerTag
from src.user.auth.service import get_current_user, is_admin
from .service import ConversationService, get_conversation_service
from .dto import AddMessageDTO, FeedbackDTO

route_conversation = APIRouter(prefix="/conversation", tags=[ControllerTag.chat])


@route_conversation.post("/create")
async def create_conversation(
    title: str = "新对话",
    mode: str = "llm",
    current_user=Depends(get_current_user),
    service: ConversationService = Depends(get_conversation_service),
):
    conv = await service.create_conversation(
        user_id=current_user.id, title=title, mode=mode
    )
    return {"id": str(conv.id), "title": conv.title, "mode": conv.mode}


@route_conversation.get("/list")
async def list_conversations(
    mode: str = None,
    current_user=Depends(get_current_user),
    service: ConversationService = Depends(get_conversation_service),
):
    return await service.list_conversations(user_id=current_user.id, mode=mode)


@route_conversation.get("/unresolved", summary="[管理] 未解决与差评队列")
async def unresolved(
    limit: int = 50,
    offset: int = 0,
    current_user=Depends(get_current_user),
    service: ConversationService = Depends(get_conversation_service),
):
    """R6 的入口：把「这次为什么没答对」变成一列能翻的东西。

    只给管理员 —— 队列里是别人的提问原文与差评备注，这不是普通用户该看的内容；
    而且它的用途是「决定回去修哪个库」，属管理动作。
    """
    if not is_admin(current_user):
        raise HTTPException(status_code=403, detail="仅管理员可查看未解决队列")
    return await service.unresolved_messages(limit=limit, offset=offset)


@route_conversation.put("/message/{message_id}/feedback", summary="标记这条回答好/坏")
async def put_feedback(
    message_id: UUID,
    dto: FeedbackDTO,
    current_user=Depends(get_current_user),
    service: ConversationService = Depends(get_conversation_service),
):
    owner = await service.message_owner(message_id)
    if owner is None:
        raise HTTPException(status_code=404, detail="消息不存在")
    if owner != current_user.id and not is_admin(current_user):
        # 反馈是「我这一条回答」的评价，别人替我表态就是伪造训练数据
        raise HTTPException(status_code=403, detail="只能评价自己的消息")
    return await service.set_feedback(
        message_id, current_user.id, dto.verdict, dto.note
    )


@route_conversation.delete("/message/{message_id}/feedback", summary="撤销反馈")
async def drop_feedback(
    message_id: UUID,
    current_user=Depends(get_current_user),
    service: ConversationService = Depends(get_conversation_service),
):
    owner = await service.message_owner(message_id)
    if owner is None:
        raise HTTPException(status_code=404, detail="消息不存在")
    if owner != current_user.id and not is_admin(current_user):
        raise HTTPException(status_code=403, detail="只能撤销自己的反馈")
    removed = await service.delete_feedback(message_id, current_user.id)
    return {"removed": removed}


async def _require_conversation(
    service: ConversationService, conv_id: UUID, current_user
):
    """会话归属判断只写这一份。

    读消息 (`/{id}/messages`) 早就判了，而**两条写路径没判**：
    `PATCH /{id}/title` 与 `POST /{id}/message` 都拿了 `current_user` 却没用 ——
    任何登录用户都能给别人正在写的会话改名、往里塞消息。
    对 #15 那条方向尤其致命：那份「标注数据集」要是别人能写，它就什么都证明不了。
    不回 403 而回 404：会话存在与否本身是信息，读路径已经按 404 的语义走，两条写路径对齐它。
    """
    conv = await service.get_conversation(conv_id)
    if not conv or conv.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


@route_conversation.get("/{conv_id}/messages")
async def get_messages(
    conv_id: UUID,
    current_user=Depends(get_current_user),
    service: ConversationService = Depends(get_conversation_service),
):
    await _require_conversation(service, conv_id, current_user)
    messages = await service.get_messages(conv_id)
    feedback = await service.feedback_map([m.id for m in messages])
    return [
        {
            "id": str(m.id),
            "role": m.role,
            "content": m.content,
            "created_at": m.created_at.isoformat(),
            # 带出 meta，历史消息才能把引用一并恢复
            "meta": m.meta,
            # status 以前是「写了但没人读」的那一列：服务端现在按引用与失败推导它，
            # 界面据此才能把「没有依据的回答」和「回答得不好」区分开。
            "status": m.status,
            "feedback": feedback.get(str(m.id)),
        }
        for m in messages
    ]


@route_conversation.patch("/{conv_id}/title")
async def update_title(
    conv_id: UUID,
    title: str,
    current_user=Depends(get_current_user),
    service: ConversationService = Depends(get_conversation_service),
):
    await _require_conversation(service, conv_id, current_user)
    await service.update_title(conv_id, title)
    return {"message": "ok"}


@route_conversation.delete("/{conv_id}")
async def delete_conversation(
    conv_id: UUID,
    current_user=Depends(get_current_user),
    service: ConversationService = Depends(get_conversation_service),
):
    deleted = await service.delete_conversation(conv_id, current_user.id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"message": "ok"}


@route_conversation.post("/{conv_id}/message")
async def add_message(
    conv_id: UUID,
    dto: AddMessageDTO,
    current_user=Depends(get_current_user),
    service: ConversationService = Depends(get_conversation_service),
    redis_client=Depends(get_redis),
):
    await _require_conversation(service, conv_id, current_user)

    meta = dict(dto.meta or {})
    # 客户端递来的 `retrieval` 一律丢掉：检索中间态只能由服务端按会话号取回。
    # 否则「这条回答当时看到几条、最高分多少」就变成调用方想写什么写什么，
    # 而未解决队列的全部价值就建立在这些数字是真的上面。
    meta.pop("retrieval", None)
    if dto.retrieval_session:
        try:
            stored = redis_client.get(telemetry_key(current_user.id, dto.retrieval_session))
            if stored:
                meta["retrieval"] = loads(stored)
        except Exception as exc:  # noqa: BLE001
            # 证据取不到不影响消息本身落库；但这条降级要留痕，否则「为什么没有遥测」
            # 会变成下一个查不出来的问题。
            config_logger.warning(
                "retrieval telemetry lookup failed for %s: %s", dto.retrieval_session, exc
            )

    msg = await service.add_message(conv_id, dto.role, dto.content, meta=meta or None)
    return {"id": str(msg.id)}
