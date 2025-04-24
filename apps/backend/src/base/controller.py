from datetime import timedelta
from enum import Enum

from dotenv import dotenv_values
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from ..utils import Tags
from .auth.service import AuthService, get_current_user, permission_map
from .database import get_db
from .dto import UserBase, UserSchemas
from .service import UserService


route_base = APIRouter(prefix="/base")

ACCESS_TOKEN_EXPIRE_MINUTES = int(
    dotenv_values(".env").get("ACCESS_TOKEN_EXPIRE_MINUTES")
)


@route_base.post(
    "/registry",
    summary="创建用户",
    response_model=UserSchemas,
    response_description="返回创建的用户信息",
    status_code=status.HTTP_201_CREATED,
    tags=[Tags.user],
)
async def create_user_route(
    user: UserBase,
    db: Session = Depends(get_db),
    service: UserService = Depends(UserService),
):
    db_user = await service.get_user_by_email(db=db, user_email=user.email)
    if db_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="该邮箱已注册"
        )
    return service.create_user(db=db, user=user)


@route_base.get(
    "/user/{user_id}",
    summary="根据id获取指定用户",
    status_code=status.HTTP_200_OK,
    response_model=UserSchemas,
    response_description="返回指定用户信息",
    tags=[Tags.user],
)
async def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    service: UserService = Depends(UserService),
):
    user = await service.get_user_by_id(db=db, user_id=user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="用户未注册")
    return user


@route_base.get(
    "/users",
    summary="获取所有用户",
    status_code=status.HTTP_200_OK,
    response_model=list[UserSchemas],
    response_description="返回用户组成的list",
    tags=[Tags.user],
)
async def get_user_all(
    offset=0,
    limit=100,
    db: Session = Depends(get_db),
    service: UserService = Depends(UserService),
):
    users = await service.get_users(db=db, offset=offset, limit=limit)
    return users


@route_base.post(
    "/auth",
    summary="为登录用户设置token",
    status_code=status.HTTP_200_OK,
    response_description="返回token信息",
    tags=[Tags.auth],
)
async def login_for_access_token(
    db: Session = Depends(get_db),
    form_data: OAuth2PasswordRequestForm = Depends(),
    service: UserService = Depends(UserService),
    auth_service: AuthService = Depends(AuthService),
):
    user = auth_service.authenticate_user(
        db,
        await service.get_user_by_account(
            db=db, username=form_data.username, password=form_data.password
        ),
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = auth_service.create_access_token(
        {"sub": user.name}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}


@route_base.get(
    "/current",
    summary="获取当前用户",
    status_code=status.HTTP_200_OK,
    response_description="返回当前用户的信息",
    tags=[Tags.auth],
)
async def check_current_user(
    current_user=Depends(get_current_user),
):
    res = {}
    res["name"] = current_user.name
    res["email"] = current_user.email
    res["permissions"] = await permission_map(current_user.role_id)
    return res
