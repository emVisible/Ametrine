from fastapi import APIRouter, Depends, HTTPException, status
from src.middleware.tags import ControllerTag

from .dto import UserCreate
from .service import UserService, get_user_service

route_base = APIRouter(prefix="/user", tags=[ControllerTag.user])


@route_base.post("/create", summary="创建用户")
async def user_create(
    dto: UserCreate,
    user_service: UserService = Depends(get_user_service),
):
    db_user = await user_service.get_user_by_email(user_email=dto.email)
    if db_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="该邮箱已注册"
        )
    return await user_service.create_user(user=dto)


@route_base.get("/all", summary="获取所有用户")
async def user_all(
    offset: int = 0,
    limit: int = 30,
    user_service: UserService = Depends(get_user_service),
):
    return await user_service.get_users(offset=offset, limit=limit)


@route_base.delete("/delete", summary="删除用户")
async def user_delete(
    user_id: int,
    user_service: UserService = Depends(get_user_service),
):
    return await user_service.delete_user(user_id=user_id)


@route_base.get("/{user_id}", summary="根据id获取指定用户")
async def user_get_by_id(
    user_id: int,
    user_service: UserService = Depends(get_user_service),
):
    user = await user_service.get_user_by_id(user_id=user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="用户未注册")
    return user
