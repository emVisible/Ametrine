from sqlalchemy.orm import Session
from fastapi import Depends
from .dto import UserBase
from .database import get_db
from .models import User
from .auth.service import AuthService


class UserService:
    def __init__(self, client: Session = Depends(get_db)):
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
        self.client.commit()
        self.client.refresh(new_user)
        return new_user

    async def get_user_by_id(self, user_id: int):
        return self.client.query(User).filter(User.id == user_id).first()

    async def get_user_by_name(self, username: str):
        return self.client.query(User).filter(User.name == username).first()

    async def get_user_by_email(self, user_email: str):
        return self.client.query(User).filter(User.email == user_email).first()

    async def get_user_by_account(self, username: str, password: str):
        return (
            self.client.query(User)
            .filter(
                User.email == username
                and User.password == self.auth_service.hash_password(password)
            )
            .first()
        )

    async def get_users(self, offset: int | None, limit: int | None):
        return self.client.query(User).offset(offset=offset).limit(limit=limit).all()

    async def delete_user(self, user_id: int):
        instance = self.client.query(User).filter(User.id == user_id).first()
        self.client.delete(instance=instance)
        return True
