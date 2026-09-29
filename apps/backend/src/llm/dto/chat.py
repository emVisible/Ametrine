from typing import List, Optional

from pydantic import BaseModel
from typing_extensions import NotRequired, TypedDict


class ChatMessage(TypedDict):
    role: str
    content: Optional[str]
    user: NotRequired[str]
    tool_calls: NotRequired[List]


class LLMChat(BaseModel):
    prompt: str
    system_prompt: Optional[str] = None
    chat_history: Optional[List["ChatMessage"]] = []


class RAGChat(LLMChat):
    collection_name: str
    database_name: str
    # 检索参数原来只能靠 .env（K / P / MIN_RELEVANCE_SCORE）改一次重启一次。
    # 挪进请求体之后，界面上的滑杆才是真的在调参。
    top_k: int = 10
    rerank: bool = True
