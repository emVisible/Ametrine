# src/user/permissions/controller.py
from fastapi import APIRouter, Depends, Body, HTTPException
from src.middleware.tags import ControllerTag
from src.user.auth.service import get_current_user, get_admin_user, is_admin
from .service import PermissionService, get_permission_service

# 这个面以前完全没有鉴权依赖：匿名 POST 就能给自己在任何数据库上开 can_manage。
# 整面先要求登录，读只放开「本人或管理员」，写只放开管理员。
route_user_permission = APIRouter(
    prefix="/user/permission",
    tags=[ControllerTag.user],
    dependencies=[Depends(get_current_user)],
)


@route_user_permission.get("/{user_id}/databases")
async def get_user_permissions(
    user_id: int,
    current_user=Depends(get_current_user),
    perm_service: PermissionService = Depends(get_permission_service),
):
    if user_id != current_user.id and not is_admin(current_user):
        raise HTTPException(status_code=403, detail="无权查看该用户的授权")
    return await perm_service.get_user_database_permissions(user_id)


@route_user_permission.post(
    "/{user_id}/databases/{database_id}", dependencies=[Depends(get_admin_user)]
)
async def set_database_permission(
    user_id: int,
    database_id: int,
    can_read: bool = Body(True),
    can_write: bool = Body(False),
    can_manage: bool = Body(False),
    perm_service: PermissionService = Depends(get_permission_service),
):
    return await perm_service.set_database_permission(
        user_id, database_id, can_read, can_write, can_manage
    )


@route_user_permission.delete(
    "/{user_id}/databases/{database_id}", dependencies=[Depends(get_admin_user)]
)
async def remove_database_permission(
    user_id: int,
    database_id: int,
    perm_service: PermissionService = Depends(get_permission_service),
):
    return await perm_service.remove_database_permission(user_id, database_id)
