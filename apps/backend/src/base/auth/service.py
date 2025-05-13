from datetime import datetime, timedelta

from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.future import select
from sqlalchemy.orm import Session
from src.base.models import User
from src.config import algorithm, secret_key
from src.response import custom_jwt_exception_handler

from ..database import get_db

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth", scheme_name="data")


class AuthService:
    def __init__(self, client: Session = Depends(get_db)):
        self.client = client

    def hash_password(self, password: str) -> str:
        return pwd_context.hash(password)

    def verify_password(self, plain_password, hashed_password):
        return pwd_context.verify(plain_password, hashed_password)

    def get_password_hash(self, plain_password):
        return pwd_context.hash(plain_password)

    def authenticate_user(self, user, password: str):
        if not user:
            return False
        if not self.verify_password(password, user.password):
            return False
        return user

    def create_access_token(self, data: dict, expires_delta: timedelta | None = None):
        to_encode = data.copy()
        if expires_delta:
            expire = datetime.utcnow() + expires_delta
        else:
            expire = datetime.utcnow() + timedelta(minutes=30)
        to_encode.update({"exp": expire})
        encoded_jwt = jwt.encode(to_encode, key=secret_key, algorithm=algorithm)
        return encoded_jwt


async def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
):
    try:
        payload: dict = jwt.decode(token=token, key=secret_key, algorithms=[algorithm])
        username = payload.get("sub")
        user = await db.execute(
            select(User).where((User.email == username) | (User.name == username))
        )
    except JWTError:
        raise custom_jwt_exception_handler()
    return user.scalar_one_or_none()


async def permission_map(permission_id: int):
    map = {
        1: ["student"],
        2: ["student", "teacher"],
        3: ["student", "teacher", "director"],
        4: ["student", "teacher", "director", "admin"],
        5: ["student", "teacher", "director", "admin", "root"],
    }
    return map[permission_id]
