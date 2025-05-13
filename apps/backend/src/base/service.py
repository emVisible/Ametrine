from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.exc import NoResultFound
from fastapi import Depends
from .dto import UserBase
from .database import get_db
from .models import User
from .auth.service import AuthService


class UserService:
    def __init__(self, client: AsyncSession = Depends(get_db)):
        self.auth_service = AuthService()
        self.client = client

    async def create_user(self, user: UserBase):
        hashed_passwd = self.auth_service.hash_password(user.password)
        new_user = User(
            email=user.email,
            name=user.name,
            password=hashed_passwd,
            role_id=1,
        )
        self.client.add(new_user)
        await self.client.commit()
        await self.client.refresh(new_user)
        return new_user

    async def get_user_by_id(self, user_id: int):
        result = await self.client.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def get_user_by_name(self, username: str):
        result = await self.client.execute(select(User).where(User.name == username))
        return result.scalar_one_or_none()

    async def get_user_by_email(self, user_email: str):
        result = await self.client.execute(select(User).where(User.email == user_email))
        return result.scalar_one_or_none()

    async def get_user_by_account(self, username: str):
        # hashed = self.auth_service.hash_password(password)
        result = await self.client.execute(
            select(User).where((User.email == username) | (User.name == username))
        )
        return result.scalar_one_or_none()

    async def get_users(self, offset: int = 0, limit: int = 100):
        result = await self.client.execute(select(User).offset(offset).limit(limit))
        return result.scalars().all()

    async def delete_user(self, user_id: int):
        result = await self.client.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if user:
            await self.client.delete(user)
            await self.client.commit()
            return True
        return False
