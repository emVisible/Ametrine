from typing import Optional

from fastapi import Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from src.client import get_relation_db
from src.models import User
from src.utils.security import hash
from .dto import UserCreate, UserUpdate, UserRead, UserListResponse


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

    async def get_users(self, offset: int = 0, limit: int = 100) -> UserListResponse:
        result = await self.relation_db.execute(
            select(User).offset(offset).limit(limit)
        )
        users = result.scalars().all()

        count_result = await self.relation_db.execute(select(func.count(User.id)))
        total = count_result.scalar()

        return UserListResponse(
            users=[UserRead.model_validate(u) for u in users],
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
