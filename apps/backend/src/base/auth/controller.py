from datetime import timedelta

from dotenv import dotenv_values
from fastapi import APIRouter, Depends
from fastapi.security import OAuth2PasswordRequestForm
from src.logger import Tags
from src.response import custom_jwt_exception_handler

from ..service import UserService
from .service import AuthService, get_current_user, permission_map

route_auth = APIRouter()
ACCESS_TOKEN_EXPIRE_MINUTES = int(
    dotenv_values(".env").get("ACCESS_TOKEN_EXPIRE_MINUTES")
)


@route_auth.post(
    "/auth",
    summary="为用户设置token",
    tags=[Tags.auth],
)
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    service: UserService = Depends(UserService),
    auth_service: AuthService = Depends(AuthService),
):
    try:
        user = await service.get_user_by_account(username=form_data.username)
        verified_user = auth_service.authenticate_user(user, form_data.password)
        access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = auth_service.create_access_token(
            {"sub": verified_user.name}, expires_delta=access_token_expires
        )
    except:
        raise custom_jwt_exception_handler()
    return {"access_token": access_token, "token_type": "bearer"}


@route_auth.get(
    "/current",
    summary="获取当前用户",
    tags=[Tags.auth],
)
async def check_current_user(current_user=Depends(get_current_user)):
    res = {}
    res["name"] = current_user.name
    res["email"] = current_user.email
    res["permissions"] = await permission_map(current_user.role_id)
    return res
