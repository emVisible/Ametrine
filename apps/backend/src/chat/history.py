from uuid import UUID, uuid4

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from src.client import get_relation_db
from src.conversation.service import derive_message_status
from src.models import Conversation, Message, ToolCall


class ChatHistoryService:
    def __init__(self, relation_db: AsyncSession):
        self.relation_db = relation_db

    async def ensure_conversation(
        self,
        conversation_id: str | None,
        mode: str,
        title: str | None = None,
        user_id: int | None = None,
    ) -> Conversation:
        parsed_id = self._parse_uuid(conversation_id)
        result = await self.relation_db.execute(
            select(Conversation).where(Conversation.id == parsed_id)
        )
        conversation = result.scalar_one_or_none()
        if conversation:
            if user_id is not None and conversation.user_id not in (None, user_id):
                # 旧实现只按 id 查，任何人报一个别人的 conversation_id 就能读写别人的历史
                raise PermissionError("该会话不属于当前用户")
            if conversation.user_id is None and user_id is not None:
                # 历史遗留的无主会话（旧版本不写 user_id）在此认领给当前用户
                conversation.user_id = user_id
                await self.relation_db.commit()
                await self.relation_db.refresh(conversation)
            return conversation

        conversation = Conversation(
            id=parsed_id,
            title=title or "New Conversation",
            mode=mode,
            # 旧实现不写 user_id，于是这条会话在按用户过滤的 /conversation/list 里永远看不见，
            # 也永远删不掉 —— 就是那批「神秘空会话」的来源
            user_id=user_id,
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
        status: str | None = None,
        model: str | None = None,
        meta: dict | None = None,
    ) -> Message:
        # 只有「调用方确实知道失败」时才用它传的值，其余一律服务端推导 ——
        # 判据只有一份（conversation.service.derive_message_status），
        # 否则 HTTP 路径与 /api/chat 路径会各写一套状态语义，又是两个事实源。
        message = Message(
            conversation_id=conversation_id,
            role=role,
            content=content,
            status=status or derive_message_status(role, content, meta),
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
