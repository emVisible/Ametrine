from fastapi import Depends, HTTPException, status
from jose import JWTError, jwt
from sqlalchemy.orm import Session
from . import dto, models
from .dto import UserBase
from .models import User
from .auth.service import AuthService
from src.config import secret_key, algorithm
from .database import get_db


class UserService:
    def __init__(self):
        self.auth_service = AuthService()

    async def create_user(self, db: Session, user: UserBase):
        hashed_passwd = self.auth_service.hash_password(user.password)
        new_user = User(
            email=user.email,
            name=user.name,
            password=hashed_passwd,
            role_id=1,
        )
        db.add(new_user)
        db.commit()
        db.refresh(new_user)
        return new_user

    async def get_user_by_id(self, db: Session, user_id: int):
        return db.query(models.User).filter(models.User.id == user_id).first()

    async def get_user_by_name(self, db: Session, username: str):
        return db.query(models.User).filter(models.User.name == username).first()

    async def get_user_by_email(self, db: Session, user_email: str):
        return db.query(models.User).filter(models.User.email == user_email).first()

    async def get_user_by_account(self, db: Session, username: str, password: str):
        return (
            db.query(models.User)
            .filter(
                models.User.email == username
                and models.User.password == self.auth_service.hash_password(password)
            )
            .first()
        )

    async def get_users(self, db: Session, offset: int | None, limit: int | None):
        return db.query(models.User).offset(offset=offset).limit(limit=limit).all()
