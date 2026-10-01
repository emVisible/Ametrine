from typing import Optional

from fastapi import Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from src.client import get_relation_db
from src.models import User
from src.utils.security import hash
from .dto import UserCreate, UserUpdate, UserRead, UserListResponse

# 改这些字段 = 这个人的身份/权限变了 = 之前发的会话一律不再可信。
# 刻意**不含** name/email/avatar/preferences/system_prompt/配额：
# 那些是个人偏好或资源策略，改了不该把人从正在写的对话里踢出去。
_SESSION_REVOKING_FIELDS = frozenset({"role_id", "is_active", "password", "tenant_id"})


class UserService:
    def __init__(self, relation_db: AsyncSession):
        self.relation_db = relation_db

    async def create_user(self, user: UserCreate) -> User:
        if user.email:
            existing = await self.get_user_by_email(user.email)
            if existing:
                raise ValueError("email has been registered")
        existing = await self.get_user_by_name(user.name)
        if existing:
            raise ValueError("username is already taken")

        hashed_passwd = hash(user.password)
        new_user = User(
            email=user.email,
            name=user.name,
            password=hashed_passwd,
            role_id=1,
        )
        self.relation_db.add(new_user)
        await self.relation_db.commit()
        await self.relation_db.refresh(new_user)
        return new_user

    async def get_user_by_id(self, user_id: int) -> Optional[User]:
        result = await self.relation_db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def get_user_by_name(self, username: str) -> Optional[User]:
        result = await self.relation_db.execute(
            select(User).where(User.name == username)
        )
        return result.scalar_one_or_none()

    async def get_user_by_email(self, user_email: str) -> Optional[User]:
        result = await self.relation_db.execute(
            select(User).where(User.email == user_email)
        )
        return result.scalar_one_or_none()

    async def get_user_by_account(self, username: str) -> Optional[User]:
        user = await self.get_user_by_email(username)
        if user:
            return user
        return await self.get_user_by_name(username)

    async def read_model(self, user: User) -> UserRead:
        """把一个用户变成对外形状，并把用量填成**现算值**。

        `user.daily_token_used` 那三列没有任何写入方，直接 model_validate 会让
        设置页与个人主页的用量条永远显示 0（而 `/api/current` 那边是算出来的真值）。
        填数这件事只在这里做一次，两个读端点都走它，避免又长出第二种算法。
        """
        from src.user.quota import period_usage

        row = UserRead.model_validate(user)
        row.daily_token_used = await period_usage(self.relation_db, user.id, "day")
        row.monthly_token_used = await period_usage(self.relation_db, user.id, "month")
        row.total_token_used = await period_usage(self.relation_db, user.id, "all")
        return row

    async def get_users(self, offset: int = 0, limit: int = 100) -> UserListResponse:
        result = await self.relation_db.execute(
            select(User).offset(offset).limit(limit)
        )
        users = result.scalars().all()

        count_result = await self.relation_db.execute(select(func.count(User.id)))
        total = count_result.scalar()

        return UserListResponse(
            users=[await self.read_model(u) for u in users],
            total=total,
            offset=offset,
            limit=limit,
        )

    async def update_user(self, user_id: int, dto: UserUpdate) -> User:
        user = await self.get_user_by_id(user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="用户不存在"
            )

        update_data = dto.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(user, key, value)
        # 动了「身份相关」字段就自增会话代号，等于把这个人已有的令牌一次作废。
        # 判断只写在这一处：PATCH 走它、将来的改密/换租户也走它，
        # 放在控制器里就会变成「哪个入口记得 bump」的逐次自觉 —— 那正是会漏的那种设计。
        if _SESSION_REVOKING_FIELDS & set(update_data):
            user.token_version = (user.token_version or 0) + 1

        await self.relation_db.commit()
        await self.relation_db.refresh(user)
        return user

    async def delete_user(self, user_id: int) -> bool:
        user = await self.get_user_by_id(user_id)
        if not user:
            return False
        await self.relation_db.delete(user)
        await self.relation_db.commit()
        return True


def get_user_service(relation_db: AsyncSession = Depends(get_relation_db)):
    return UserService(relation_db=relation_db)
