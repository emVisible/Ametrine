from datetime import timedelta

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from src.config import access_token_expire_minutes
from src.middleware.exceptions import JWTException
from src.middleware.tags import ControllerTag

from ..service import UserService, get_user_service
from .service import AuthService, get_auth_service, get_current_user, permission_map

route_auth = APIRouter(tags=[ControllerTag.auth])


@route_auth.post(
    "/auth",
    summary="为用户设置token",
    response_class=JSONResponse,
)
async def login_for_access_token(
    form_data: OAuth2PasswordRequestForm = Depends(),
    user_service: UserService = Depends(get_user_service),
    auth_service: AuthService = Depends(get_auth_service),
):
    try:
        user = await user_service.get_user_by_account(username=form_data.username)
        verified_user = auth_service.authenticate_user(user, form_data.password)
        access_token_expires = timedelta(minutes=access_token_expire_minutes)
        access_token = auth_service.create_access_token(
            {"sub": verified_user.name}, expires_delta=access_token_expires
        )
    except:
        raise JWTException()
    return {"access_token": access_token, "token_type": "bearer"}


@route_auth.get("/current", summary="获取当前用户")
async def check_current_user(current_user=Depends(get_current_user)):
    res = {}
    res["name"] = current_user.name
    res["email"] = current_user.email
    res["permissions"] = permission_map(current_user.role_id)
    return res
