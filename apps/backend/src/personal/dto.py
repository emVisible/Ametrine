from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

MAX_TEXT = 4000


class PersonalLedgerIn(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_TEXT)
    actor: str | None = Field(default=None, min_length=1, max_length=64)
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


class PersonalPeriodOut(BaseModel):
    level: str
    period_key: str
    start_date: str
    end_date: str
    item_count: int
    content_digest: str
    parent_keys: list[str]


class PersonalPeriodDetailOut(PersonalPeriodOut):
    catalog: list[dict]
    source_ids: list[str]


class PersonalDecisionOut(BaseModel):
    event_id: str
    seq: int
    actor: str
    at: str
    marker: str
    excerpt: str
    status: str


class PersonalKeepIn(BaseModel):
    event_id: str = Field(..., min_length=1, max_length=32)
    why: str = Field(default="", max_length=200)


class PersonalResolveIn(BaseModel):
    event_id: str | None = Field(default=None, max_length=32)
    text: str | None = Field(default=None, max_length=MAX_TEXT)
    phrase: str | None = Field(default=None, max_length=40)
    actor: str = Field(default="哥哥", max_length=64)
    at: datetime | None = None
    session: str | None = Field(default=None, max_length=80)


class PersonalActionIn(BaseModel):
    event_id: str = Field(..., min_length=1, max_length=32)
    reason: str = Field(..., min_length=1, max_length=200)


class PersonalSettingsIn(BaseModel):
    actor: str = Field(default="哥哥", min_length=1, max_length=40)
    timezone: str = Field(default="Asia/Shanghai", min_length=1, max_length=64)


class PersonalSettingsOut(PersonalSettingsIn):
    pass
