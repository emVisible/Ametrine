from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class UserCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=30)
    password: str = Field(..., min_length=4, max_length=256)
    email: Optional[EmailStr] = None


class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=30)
    email: Optional[EmailStr] = None
    avatar_url: Optional[str] = None
    is_active: Optional[bool] = None
    role_id: Optional[int] = None
    preferences: Optional[dict] = None
    system_prompt: Optional[str] = None
    daily_token_limit: Optional[int] = None
    monthly_token_limit: Optional[int] = None


class UserRead(BaseModel):
    id: int
    name: str
    email: Optional[str] = None
    avatar_url: Optional[str] = None
    is_active: bool
    role_id: int
    tenant_id: Optional[int] = None
    preferences: Optional[dict] = None
    system_prompt: Optional[str] = None
    daily_token_used: int
    daily_token_limit: int
    monthly_token_used: int
    monthly_token_limit: int
    total_token_used: int
    created_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class UserListResponse(BaseModel):
    users: list[UserRead]
    total: int
    offset: int
    limit: int
