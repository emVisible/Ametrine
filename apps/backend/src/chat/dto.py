from typing import Literal, Optional

from pydantic import BaseModel, Field
from src.llm.dto.chat import ChatMessage


class ChatRAGOptions(BaseModel):
    database_name: str = "default"
    collection_name: str = "default"


class ChatOptions(BaseModel):
    stream: bool = True
    voice_reply: bool = False


class ChatRequest(BaseModel):
    conversation_id: Optional[str] = None
    mode: Literal["llm", "rag", "agent"] = "llm"
    message: str
    chat_history: list[ChatMessage] = Field(default_factory=list)
    system_prompt: Optional[str] = None
    rag: Optional[ChatRAGOptions] = None
    options: ChatOptions = Field(default_factory=ChatOptions)


class ChatResponse(BaseModel):
    conversation_id: Optional[str] = None
    content: str
    references: list = Field(default_factory=list)

