# src/user/dto.py
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
    is_active: bool = True               
    role_id: int
    tenant_id: Optional[int] = None
    preferences: Optional[dict] = None
    system_prompt: Optional[str] = None
    # 这三个数字**不再是 ORM 列的值**。那三列（daily/monthly/total_token_used）全仓没有
    # 任何写入方，直接 model_validate 出来对每个人都恒为 0，而设置页与个人主页的用量条
    # 读的就是它们 —— 于是界面显示「已用 0」。现在由 UserService 用 quota.py 的同一份
    # 现算口径填进来（与 /api/current、租户总览完全一致）。列本身留着不删是毁数据的迁移，
    # 等你决定；关键是**再没有人从它们读数**。
    daily_token_used: int = 0
    daily_token_limit: int = 100000
    monthly_token_used: int = 0
    monthly_token_limit: int = 3000000
    total_token_used: int = 0
    created_at: Optional[datetime] = None
    last_login_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class UserListResponse(BaseModel):
    users: list[UserRead]
    total: int
    offset: int
    limit: int