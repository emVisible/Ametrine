from uuid import UUID, uuid4

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from src.client import get_relation_db
from src.models import Conversation, Message, ToolCall


class ChatHistoryService:
    def __init__(self, relation_db: AsyncSession):
        self.relation_db = relation_db

    async def ensure_conversation(
        self,
        conversation_id: str | None,
        mode: str,
        title: str | None = None,
    ) -> Conversation:
        parsed_id = self._parse_uuid(conversation_id)
        result = await self.relation_db.execute(
            select(Conversation).where(Conversation.id == parsed_id)
        )
        conversation = result.scalar_one_or_none()
        if conversation:
            return conversation

        conversation = Conversation(
            id=parsed_id,
            title=title or "New Conversation",
            mode=mode,
        )
        self.relation_db.add(conversation)
        await self.relation_db.commit()
        await self.relation_db.refresh(conversation)
        return conversation

    async def create_message(
        self,
        conversation_id: UUID,
        role: str,
        content: str,
        status: str = "done",
        model: str | None = None,
        meta: dict | None = None,
    ) -> Message:
        message = Message(
            conversation_id=conversation_id,
            role=role,
            content=content,
            status=status,
            model=model,
            meta=meta,
        )
        self.relation_db.add(message)
        await self.relation_db.commit()
        await self.relation_db.refresh(message)
        return message

    async def create_tool_call(
        self,
        conversation_id: UUID,
        tool_name: str | None,
        tool_input,
        status: str = "observed",
        risk_level: str = "medium",
        meta: dict | None = None,
    ) -> ToolCall:
        tool_call = ToolCall(
            conversation_id=conversation_id,
            tool_name=tool_name or "unknown",
            input={"value": tool_input},
            status=status,
            risk_level=risk_level,
            meta=meta,
        )
        self.relation_db.add(tool_call)
        await self.relation_db.commit()
        await self.relation_db.refresh(tool_call)
        return tool_call

    def _parse_uuid(self, value: str | None) -> UUID:
        if not value:
            return uuid4()
        try:
            return UUID(value)
        except ValueError:
            return uuid4()


def get_chat_history_service(
    relation_db: AsyncSession = Depends(get_relation_db),
) -> ChatHistoryService:
    return ChatHistoryService(relation_db=relation_db)
