from fastapi import APIRouter, Depends, HTTPException, status
from .dto import UserBase
from .service import UserService
from ..utils import Tags


route_base = APIRouter(prefix="/user", tags=[Tags.user])


@route_base.post(
    "/create",
    summary="创建用户",
    response_description="返回创建的用户信息",
)
async def user_create(
    user: UserBase,
    service: UserService = Depends(UserService),
):
    db_user = await service.get_user_by_email(user_email=user.email)
    if db_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="该邮箱已注册"
        )
    return await service.create_user(user=user)


@route_base.delete(
    "/delete",
    summary="删除用户",
    response_description="返回是否成功",
)
async def user_delete(
    user_id: int,
    service: UserService = Depends(UserService),
):
    return await service.delete_user(user_id=user_id)


@route_base.get(
    "/all",
    summary="获取所有用户",
    response_description="返回用户组成的list",
)
async def user_all(
    offset=0,
    limit=100,
    service: UserService = Depends(UserService),
):
    users = await service.get_users(offset=offset, limit=limit)
    return users


@route_base.get(
    "/{user_id}",
    summary="根据id获取指定用户",
)
async def user_get_by_id(
    user_id: int,
    service: UserService = Depends(UserService),
):
    user = await service.get_user_by_id(user_id=user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="用户未注册")
    return user
