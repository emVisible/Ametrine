from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

MAX_TEXT = 4000


class PersonalLedgerIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_TEXT)
    actor: str = Field(default="哥哥", min_length=1, max_length=64)
    kind: Literal["ask", "answer", "reply", "note", "pref"] = "ask"
    source: str = Field(default="live", max_length=32)
    at: datetime | None = None
    session_id: str | None = Field(default=None, max_length=80)
    provenance: dict = Field(default_factory=dict)


class PersonalLedgerOut(BaseModel):
    seq: int
    id: str
    occurred_at: str
    actor: str
    source: str
    kind: str
    text: str
    valid_until: str | None = None
    provenance: dict = Field(default_factory=dict)


class PersonalVerifyOut(BaseModel):
    verdict: str
    rows: int
    tail: str | None
    errors: list[str] = Field(default_factory=list)


class PersonalMemoryItem(BaseModel):
    event_id: str
    phase: str
    strength: float
    holds: bool
    reasons: list[str]
    age: int | None
    actor: str
    date: str
    excerpt: str


class PersonalMemoryOut(BaseModel):
    today: date
    counts: dict[str, int]
    holding: int
    meter: dict
    items: list[PersonalMemoryItem]
