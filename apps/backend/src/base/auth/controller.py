from dotenv import dotenv_values
from fastapi.security import OAuth2PasswordRequestForm
from fastapi import APIRouter, Depends, HTTPException, status
from datetime import timedelta
from src.utils import Tags
from ..service import UserService
from .service import AuthService, get_current_user, permission_map

route_auth = APIRouter()
ACCESS_TOKEN_EXPIRE_MINUTES = int(
    dotenv_values(".env").get("ACCESS_TOKEN_EXPIRE_MINUTES")
)


@route_auth.post(
    "/auth",
    summary="为登录用户设置token",
    tags=[Tags.auth],
)
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    service: UserService = Depends(UserService),
    auth_service: AuthService = Depends(AuthService),
):
    user = auth_service.authenticate_user(
        await service.get_user_by_account(
            username=form_data.username, password=form_data.password
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


@route_auth.get(
    "/current",
    summary="获取当前用户",
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
