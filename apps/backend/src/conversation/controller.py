from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from src.middleware.tags import ControllerTag
from src.user.auth.service import get_current_user
from .service import ConversationService, get_conversation_service
from .dto import AddMessageDTO

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


@route_conversation.get("/{conv_id}/messages")
async def get_messages(
    conv_id: UUID,
    current_user=Depends(get_current_user),
    service: ConversationService = Depends(get_conversation_service),
):
    conv = await service.get_conversation(conv_id)
    if not conv or conv.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Conversation not found")
    messages = await service.get_messages(conv_id)
    return [
        {
            "id": str(m.id),
            "role": m.role,
            "content": m.content,
            "created_at": m.created_at.isoformat(),
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
):
    msg = await service.add_message(conv_id, dto.role, dto.content)
    return {"id": str(msg.id)}
