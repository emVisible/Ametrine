from typing import List, Optional

from pydantic import BaseModel, Field
from typing_extensions import NotRequired, TypedDict

from src.config import max_history_messages, max_prompt_chars, max_top_k


class ChatMessage(TypedDict):
    role: str
    content: Optional[str]
    user: NotRequired[str]
    tool_calls: NotRequired[List]


class LLMChat(BaseModel):
    # 入侧预算：长度与历史条数都有上限。这不是防普通用户，而是防
    # 「一个请求把共享 GPU 的上下文窗口占满」这类放大 —— 出侧有 K/P，入侧原来什么都没有。
    prompt: str = Field(..., min_length=1, max_length=max_prompt_chars)
    # system_prompt 这个字段已删：两条对话路由都只认「库里这个账号写好的偏好」，
    # 客户端自带的同名字段一律不采信（那是把 RAG 的引用约束交给调用方关掉）。
    # 留着它，OpenAPI 上就还挂着「你可以覆盖系统提示」这个假承诺。
    chat_history: Optional[List["ChatMessage"]] = Field(
        default_factory=list, max_length=max_history_messages
    )


class RAGSource(BaseModel):
    """一个检索来源：哪个库的哪个集合。"""

    database_name: str
    collection_name: str


class RAGChat(LLMChat):
    collection_name: str
    database_name: str
    # 跨库检索。给了 sources 且不止一项时走多路召回 + RRF 融合，
    # 单项/为空都退回上面那两个标量 —— 老前端因此完全不受影响。
    sources: Optional[List["RAGSource"]] = Field(
        default=None, max_length=max_top_k
    )
    # 检索参数原来只能靠 .env（K / P / MIN_RELEVANCE_SCORE）改一次重启一次。
    # 挪进请求体之后，界面上的滑杆才是真的在调参。
    # 越界是 422，不是悄悄夹住：把调用方给的 100000 静默改成 20 是另一种不诚实。
    top_k: int = Field(default=10, ge=1, le=max_top_k)
    rerank: bool = True
