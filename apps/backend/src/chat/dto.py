from typing import Literal, Optional

from pydantic import BaseModel, Field
from src.config import max_history_messages, max_prompt_chars
from src.llm.dto.chat import ChatMessage


class ChatRAGOptions(BaseModel):
    database_name: str = "default"
    collection_name: str = "default"


class ChatOptions(BaseModel):
    stream: bool = True
    voice_reply: bool = False


class ChatRequest(BaseModel):
    conversation_id: Optional[str] = None
    # 原来这里还允许 "agent"，但仓库里没有任何 agent 运行时：请求带 mode="agent"
    # 会静默走 llm 分支，并把 mode 原样写进 message.meta —— API 承诺了一个不存在的能力。
    # 删掉这个取值之后，pydantic 直接给 422，不需要再手写拒绝。
    mode: Literal["llm", "rag"] = "llm"
    # 入侧预算：与 /api/llm/* 同一组上限（同一个配置键，不另立口径）
    message: str = Field(..., min_length=1, max_length=max_prompt_chars)
    chat_history: list[ChatMessage] = Field(
        default_factory=list, max_length=max_history_messages
    )
    # system_prompt 这个字段已删：路由从来只认库里那个账号写好的偏好，
    # 客户端自带的同名字段故意不采信（那是防注入的一条边界）。
    # 留着它就等于在 API 上挂一个"你可以覆盖系统提示"的假承诺。
    rag: Optional[ChatRAGOptions] = None
    options: ChatOptions = Field(default_factory=ChatOptions)


class ChatResponse(BaseModel):
    conversation_id: Optional[str] = None
    content: str
    references: list = Field(default_factory=list)

