from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel


class Document(BaseModel):
    text: str


class Result(BaseModel):
    index: int
    relevance_score: float
    document: Document


class Meta(BaseModel):
    api_version: Optional[str] = None
    billed_units: Optional[int] = None
    tokens: Optional[int] = None
    warnings: Optional[str] = None


class RerankResult(BaseModel):
    id: UUID
    results: List[Result]
    meta: Meta
