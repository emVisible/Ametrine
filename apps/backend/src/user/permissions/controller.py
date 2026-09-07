# src/user/permissions/controller.py
from fastapi import APIRouter, Depends, Body
from src.middleware.tags import ControllerTag
from src.user.auth.service import get_current_user
from src.relation.databases.service import DatabaseService, get_database_service
from .service import PermissionService, get_permission_service

route_user_permission = APIRouter(prefix="/user/permission", tags=[ControllerTag.user])


@route_user_permission.get("/{user_id}/databases")
async def get_user_permissions(
    user_id: int,
    perm_service: PermissionService = Depends(get_permission_service),
):
    return await perm_service.get_user_database_permissions(user_id)


@route_user_permission.post("/{user_id}/databases/{database_id}")
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


@route_user_permission.delete("/{user_id}/databases/{database_id}")
async def remove_database_permission(
    user_id: int,
    database_id: int,
    perm_service: PermissionService = Depends(get_permission_service),
):
    return await perm_service.remove_database_permission(user_id, database_id)
