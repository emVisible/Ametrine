from uuid import UUID, uuid4
from datetime import datetime, timezone
from typing import Optional
from fastapi import Depends
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from src.client import get_relation_db
from src.models import Conversation, Message


class ConversationService:
    def __init__(self, relation_db: AsyncSession):
        self.relation_db = relation_db

    async def create_conversation(
        self, user_id: int, title: str = "新对话", mode: str = "llm"
    ) -> Conversation:
        conv = Conversation(
            id=uuid4(),
            title=title,
            mode=mode,
            user_id=user_id,
        )
        self.relation_db.add(conv)
        await self.relation_db.commit()
        await self.relation_db.refresh(conv)
        return conv

    async def get_conversation(self, conv_id: UUID) -> Optional[Conversation]:
        result = await self.relation_db.execute(
            select(Conversation).where(Conversation.id == conv_id)
        )
        return result.scalar_one_or_none()

    async def list_conversations(
        self, user_id: int, mode: Optional[str] = None, limit: int = 50
    ):
        query = (
            select(Conversation)
            .where(Conversation.user_id == user_id)
            .order_by(desc(Conversation.updated_at))
            .limit(limit)
        )
        if mode:
            query = query.where(Conversation.mode == mode)
        result = await self.relation_db.execute(query)
        conversations = result.scalars().all()

        # 每条对话取最后一条消息作为预览
        data = []
        for conv in conversations:
            last_msg = await self._get_last_message(conv.id)
            data.append({
                "id": str(conv.id),
                "title": conv.title,
                "mode": conv.mode,
                "created_at": conv.created_at.isoformat(),
                "updated_at": conv.updated_at.isoformat(),
                "last_message": last_msg.content[:100] if last_msg else None,
            })
        return data

    async def update_title(self, conv_id: UUID, title: str):
        conv = await self.get_conversation(conv_id)
        if conv:
            conv.title = title
            await self.relation_db.commit()

    async def delete_conversation(self, conv_id: UUID, user_id: int) -> bool:
        result = await self.relation_db.execute(
            select(Conversation).where(
                Conversation.id == conv_id, Conversation.user_id == user_id
            )
        )
        conv = result.scalar_one_or_none()
        if conv:
            await self.relation_db.delete(conv)
            await self.relation_db.commit()
            return True
        return False

    async def add_message(
        self,
        conv_id: UUID,
        role: str,
        content: str,
        status: str = "done",
    ) -> Message:
        msg = Message(
            id=uuid4(),
            conversation_id=conv_id,
            role=role,
            content=content,
            status=status,
        )
        self.relation_db.add(msg)

        # 更新对话的 updated_at
        conv = await self.get_conversation(conv_id)
        if conv:
            conv.updated_at = datetime.now(timezone.utc)
            # 自动用第一条用户消息作标题
            if conv.title == "新对话" and role == "user":
                conv.title = content[:50]

        await self.relation_db.commit()
        return msg

    async def get_messages(self, conv_id: UUID):
        result = await self.relation_db.execute(
            select(Message)
            .where(Message.conversation_id == conv_id)
            .order_by(Message.created_at)
        )
        return result.scalars().all()

    async def _get_last_message(self, conv_id: UUID):
        result = await self.relation_db.execute(
            select(Message)
            .where(Message.conversation_id == conv_id)
            .order_by(desc(Message.created_at))
            .limit(1)
        )
        return result.scalar_one_or_none()


def get_conversation_service(relation_db: AsyncSession = Depends(get_relation_db)):
    return ConversationService(relation_db=relation_db)