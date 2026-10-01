from uuid import UUID, uuid4
from datetime import datetime, timezone
from typing import Optional
from fastapi import Depends, HTTPException
from sqlalchemy import desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from src.client import get_relation_db
from src.models import Conversation, Message, MessageFeedback, User

# `message.status` 早就存在，但从来没有被真正写全、也没有被读出来（见交接文档 §3.3）。
# 这一组取值是这条链的地基：没有可筛的失败集合，「反馈」与「标注」都无处落脚。
#   done          正常回答
#   no_reference  检索零命中 / 全部低于阈值 —— 答案没有可核对的部分
#   failed        生成过程中报错，或一个字都没产出
# 刻意**没有** refused：现在没有任何可靠信号区分「模型主动拒答」和「它就是这么写的」，
# 加一个没人写得对的枚举值，只会变成下一个骗人的字段。
ASSISTANT_STATUSES = ("done", "no_reference", "failed")


def derive_message_status(role: str, content: str, meta: dict | None) -> str:
    """状态由服务端算出来，绝不采信调用方传来的 status。

    判据只有一条：**这条回答有没有可核对的部分**。
    引用为空数组是客户端与 `/api/chat` 都会给的事实；没给（旧客户端、纯 LLM 对话）
    就当未知，不据此宣布「无依据」——把没测到的东西写成结论，正是这个仓库反复犯过的错。
    """
    if role != "assistant":
        return "done"
    meta = meta or {}
    if meta.get("error") or not (content or "").strip():
        return "failed"
    references = meta.get("references")
    if isinstance(references, list) and len(references) == 0:
        return "no_reference"
    return "done"


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
        status: str | None = None,
        meta: dict | None = None,
    ) -> Message:
        # 调用方不再能自报状态：助手消息一律由服务端推导，其它角色没有传就用默认值，
        # 否则「界面说自己成功了」就成了事实源。
        resolved = derive_message_status(role, content, meta) if role == "assistant" else (status or "done")
        msg = Message(
            id=uuid4(),
            conversation_id=conv_id,
            role=role,
            content=content,
            status=resolved,
            meta=meta,
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

    async def message_owner(self, message_id: UUID) -> Optional[int]:
        """这条消息属于哪个用户 —— 反馈只能写给会话的主人。"""
        result = await self.relation_db.execute(
            select(Conversation.user_id)
            .join(Message, Message.conversation_id == Conversation.id)
            .where(Message.id == message_id)
        )
        return result.scalar_one_or_none()

    async def feedback_map(self, message_ids: list[UUID]) -> dict[str, dict]:
        """一次批量取回若干消息的反馈，避免每行一条查询。"""
        if not message_ids:
            return {}
        result = await self.relation_db.execute(
            select(MessageFeedback).where(
                MessageFeedback.message_id.in_(message_ids)
            )
        )
        return {
            str(fb.message_id): {
                "verdict": fb.verdict,
                "note": fb.note,
                "user_id": fb.user_id,
            }
            for fb in result.scalars().all()
        }

    async def set_feedback(
        self, message_id: UUID, user_id: int, verdict: str, note: str | None
    ) -> dict:
        """幂等 upsert：一条消息最多一条反馈，重复提交就是改口。

        这里刻意不做汇总：反馈不改变任何回答行为，它只让「差评 ∧ 无依据」变成
        一个能筛出来的列表。汇总列是下一个「有人读没人写」的死数字。
        """
        if verdict not in ("up", "down"):
            raise HTTPException(status_code=422, detail="verdict 只能是 up 或 down")
        existing = await self.relation_db.get(MessageFeedback, message_id)
        if existing:
            if existing.user_id != user_id:
                raise HTTPException(
                    status_code=403, detail="这条反馈由他人提交，不能代改"
                )
            existing.verdict = verdict
            existing.note = (note or "").strip() or None
        else:
            self.relation_db.add(
                MessageFeedback(
                    message_id=message_id,
                    user_id=user_id,
                    verdict=verdict,
                    note=(note or "").strip() or None,
                )
            )
        await self.relation_db.commit()
        return {"message_id": str(message_id), "verdict": verdict}

    async def delete_feedback(self, message_id: UUID, user_id: int) -> bool:
        existing = await self.relation_db.get(MessageFeedback, message_id)
        if not existing:
            return False
        if existing.user_id != user_id:
            raise HTTPException(status_code=403, detail="这条反馈由他人提交")
        await self.relation_db.delete(existing)
        await self.relation_db.commit()
        return True

    async def unresolved_messages(self, limit: int = 50, offset: int = 0) -> list[dict]:
        """管理台的「未解决 / 差评」队列：R6 的入口，也是 #15 #11 #10 三个 issue 的交汇处。

        筛的是「助手消息里 status 不是 done，或被点过差评的」。
        带出所属会话、提问者和当时用的库/集合，是为了让人**一步跳到能修它的地方**
        （`/admin/vector/:db/:col`），而不是看完一列文本再自己去猜。
        """
        stmt = (
            select(
                Message.id,
                Message.conversation_id,
                Message.content,
                Message.status,
                Message.created_at,
                Message.meta,
                Conversation.title,
                User.name,
                MessageFeedback.verdict,
                MessageFeedback.note,
            )
            .join(Conversation, Conversation.id == Message.conversation_id)
            .join(User, User.id == Conversation.user_id)
            .outerjoin(MessageFeedback, MessageFeedback.message_id == Message.id)
            .where(Message.role == "assistant")
            .where(
                or_(
                    Message.status != "done",
                    MessageFeedback.verdict == "down",
                )
            )
            .order_by(desc(Message.created_at))
            .offset(offset)
            .limit(limit)
        )
        rows = (await self.relation_db.execute(stmt)).all()
        return [
            {
                "message_id": str(r.id),
                "conversation_id": str(r.conversation_id),
                "conversation_title": r.title,
                "asked_by": r.name,
                "content": (r.content or "")[:400],
                "status": r.status,
                "verdict": r.verdict,
                "note": r.note,
                "created_at": r.created_at.isoformat() if r.created_at else None,
                # 这两个键由客户端在落库时带上（RAGChat 会把库/集合名写进 meta），
                # 没有就当未知，不编一个默认值出来。
                "database_name": (r.meta or {}).get("database_name"),
                "collection_name": (r.meta or {}).get("collection_name"),
                # 检索中间态：管理台要回答的不是「这条差评了」，而是「它当时看到了什么」。
                # 没有落检索的消息就是 None，界面按「无检索记录」显示，不编 0。
                "retrieval": (r.meta or {}).get("retrieval"),
            }
            for r in rows
        ]

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