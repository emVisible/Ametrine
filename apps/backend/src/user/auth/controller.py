from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from src.config import access_token_expire_minutes
from src.middleware.tags import ControllerTag
from ..service import UserService, get_user_service
from .service import AuthService, get_auth_service, get_current_user, permission_map

route_auth = APIRouter(tags=[ControllerTag.auth])


@route_auth.post(
    "/auth",
    response_class=JSONResponse,
)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    user_service: UserService = Depends(get_user_service),
    auth_service: AuthService = Depends(get_auth_service),
):
    user = await user_service.get_user_by_account(username=form_data.username)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="user not found"
        )
    if not auth_service.authenticate(user, form_data.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="username or password error",
        )
    access_token_expires = timedelta(minutes=access_token_expire_minutes)
    access_token = auth_service.create_access_token(
        {"sub": str(user.id)}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer"}


@route_auth.get("/current")
async def current_user(current_user=Depends(get_current_user)):
    return {
        "name": current_user.name,
        "email": current_user.email,
        "permissions": permission_map(current_user.role_id),
    }
