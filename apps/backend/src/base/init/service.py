from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from src.base.auth.service import AuthService, get_auth_service
from src.client import get_relation_db
from src.models import Role, User
from src.vector.service import get_vector_service, VectorService


class InitService:
    def __init__(
        self,
        client: AsyncSession,
        auth_service: AuthService,
        client_vector: VectorService,
    ):
        self.session = client
        self.auth_service = auth_service
        self.client_vector = client_vector

    async def db_init(self):
        await self.db_role_init()
        await self.db_user_init()

    async def vector_db_init(self):
        await self.client_vector.database_service.database_reset_service()
        await self.client_vector.collection_service.collection_reset_all_service()
        await self.client_vector.database_service.create_database_service(
            "_db", "young", 1, "初始化默认创建数据库"
        )
        await self.client_vector.collection_service.collection_create_service(
            "_collection", "_db", "初始化默认集合"
        )

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
    client_vector: VectorService = Depends(get_vector_service),
):
    return InitService(
        client=client, client_vector=client_vector, auth_service=auth_service
    )
