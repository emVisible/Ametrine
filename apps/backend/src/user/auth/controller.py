from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from src.client import get_relation_db
from src.config import access_token_expire_minutes
from src.middleware.tags import ControllerTag
from ..quota import usage_snapshot
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
async def current_user(
    current_user=Depends(get_current_user),
    quota_db: AsyncSession = Depends(get_relation_db),
):
    # daily_token_used 以前直接回 ORM 上那个从不被写的列，所以永远是 0。
    # 现在回派生值，并带上 monthly 与两个 unlimited 标志 ——
    # 设置页要据此决定画进度条还是写「无限制」，不该自己再判一次 limit<=0。
    return {
        "id": current_user.id,
        "name": current_user.name,
        "email": current_user.email,
        "permissions": permission_map(current_user.role_id),
        **(await usage_snapshot(quota_db, current_user)),
    }
