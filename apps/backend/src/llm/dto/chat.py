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
