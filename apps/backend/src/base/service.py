from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from src.client import get_relation_db
from src.models import User

from .auth.service import AuthService, get_auth_service
from .dto import UserCreate


class UserService:
    def __init__(
        self,
        relation_db: AsyncSession,
        auth_service: AuthService,
    ):
        self.auth_service = auth_service
        self.relation_db = relation_db

    async def create_user(self, user: UserCreate):
        hashed_passwd = self.auth_service.hash_password(user.password)
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

    async def get_user_by_id(self, user_id: int):
        result = await self.relation_db.execute(select(User).where(User.id == user_id))
        return result.scalar_one_or_none()

    async def get_user_by_name(self, username: str):
        result = await self.relation_db.execute(select(User).where(User.name == username))
        return result.scalar_one_or_none()

    async def get_user_by_email(self, user_email: str):
        result = await self.relation_db.execute(select(User).where(User.email == user_email))
        return result.scalar_one_or_none()

    async def get_user_by_account(self, username: str):
        result = await self.relation_db.execute(
            select(User).where((User.email == username) | (User.name == username))
        )
        return result.scalar_one_or_none()

    async def get_users(self, offset: int = 0, limit: int = 100):
        result = await self.relation_db.execute(select(User).offset(offset).limit(limit))
        return result.scalars().all()

    async def delete_user(self, user_id: int):
        result = await self.relation_db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if user:
            await self.relation_db.delete(user)
            await self.relation_db.commit()
            return True
        return False


def get_user_service(
    relation_db=Depends(get_relation_db), auth_service=Depends(get_auth_service)
):
    return UserService(relation_db=relation_db, auth_service=auth_service)
