from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from src.base.auth.service import AuthService, get_auth_service
from src.client import get_relation_db
from src.models import Role, User


class InitService:
    def __init__(
        self,
        client: AsyncSession,
        auth_service: AuthService,
    ):
        self.session = client
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
                email="manager@qq.com",
                password=self.auth_service.hash_password("manager"),
                role_id=2,
            ),
            User(
                name="user",
                email="user@qq.com",
                password=self.auth_service.hash_password("user"),
                role_id=1,
            ),
        ]
        self.session.add_all(users)
        await self.session.commit()


def get_init_service(
    client: AsyncSession = Depends(get_relation_db),
    auth_service: AuthService = Depends(get_auth_service),
):
    return InitService(client=client, auth_service=auth_service)
