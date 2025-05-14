from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from src.base.auth.service import AuthService
from src.base.database import get_db
from src.base.models import Role, User


class InitService:
    def __init__(
        self,
        db: AsyncSession = Depends(get_db),
        auth_service: AuthService = Depends(),
    ):
        self.session = db
        self.auth_service = auth_service

    async def db_init(self):
        await self.db_role_init()
        await self.db_user_init()

    async def db_role_init(self):
        roles = [
            Role(name="user"),
            Role(name="manager"),
            Role(name="admin"),
        ]
        self.session.add_all(roles)
        await self.session.commit()

    async def db_user_init(self):
        users = [
            User(
                name="admin",
                email="admin@qq.com",
                password=self.auth_service.hash_password("admin"),
                role_id=3,
            ),
            User(
                name="manager",
                email="teacher@qq.com",
                password=self.auth_service.hash_password("teacher"),
                role_id=2,
            ),
            User(
                name="user",
                email="student@qq.com",
                password=self.auth_service.hash_password("student"),
                role_id=1,
            ),
        ]
        self.session.add_all(users)
        await self.session.commit()
