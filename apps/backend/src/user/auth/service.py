from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from sqlalchemy.orm import Session
from src.client import get_relation_db
from src.config import algorithm, secret_key
from src.utils.security import verify
from src.user.service import UserService, get_user_service

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth", scheme_name="data")


class AuthService:
    def __init__(self, client: Session, user_service: UserService):
        self.client = client
        self.user_service = user_service

    def authenticate(self, user, password: str) -> bool:
        if not user:
            return False
        return verify(password, user.password)

    def create_access_token(self, data: dict, expires_delta: timedelta | None = None):
        to_encode = data.copy()
        if expires_delta:
            expire = datetime.now(timezone.utc) + expires_delta
        else:
            expire = datetime.now(timezone.utc) + timedelta(minutes=30)
        to_encode.update({"exp": expire})
        encoded_jwt = jwt.encode(to_encode, key=secret_key, algorithm=algorithm)
        return encoded_jwt


async def get_current_user(
    token: str = Depends(oauth2_scheme), user_service=Depends(get_user_service)
):
    try:
        payload = jwt.decode(token=token, key=secret_key, algorithms=algorithm)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials"
        )
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid user id",
        )
    user = await user_service.get_user_by_id(int(user_id))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="user not found",
        )
    return user


def permission_map(permission_id: int):
    map = {
        1: ["user"],
        2: ["user", "manager"],
        3: ["user", "manager", "admin"],
    }
    return map[permission_id]


def get_auth_service(
    client: Session = Depends(get_relation_db),
    user_service: UserService = Depends(get_user_service),
):
    return AuthService(client=client, user_service=user_service)
