from datetime import datetime, timedelta
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from src.config import algorithm, secret_key
from ..dto import TokenDataSchemas
from ..database import get_db
from .. import models
from fastapi import Depends, HTTPException, status
from sqlalchemy.orm import Session


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth")


class AuthService:
    def hash_password(self, password: str) -> str:
        return pwd_context.hash(password)

    def verify_password(self, plain_password, hashed_password):
        return pwd_context.verify(plain_password, hashed_password)

    def get_password_hash(self, plain_password):
        return pwd_context.hash(plain_password)

    def authenticate_user(self, db, user):
        if not user:
            return False
        if not self.verify_password(
            user.password, self.get_password_hash(user.password)
        ):
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
    """
    对token解码, 通过token解析出用户信息(用户信息在数据库中查找)
    """
    credential_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="User validation error(JWT error)",
        headers={"WWW-Authenticate": "bearer"},
    )
    try:
        payload: dict = jwt.decode(token=token, key=secret_key, algorithms=[algorithm])
        username = payload.get("sub")
        token_data = TokenDataSchemas(username=username)
        if not username:
            raise credential_exception
    except JWTError:
        raise credential_exception
    user = db.query(models.User).filter(models.User.name == token_data.username).first()
    if not user:
        raise credential_exception
    return user


async def permission_map(permission_id: int):
    map = {
        1: ["student"],
        2: ["student", "teacher"],
        3: ["student", "teacher", "director"],
        4: ["student", "teacher", "director", "admin"],
        5: ["student", "teacher", "director", "admin", "root"],
    }
    return map[permission_id]
