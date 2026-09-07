# src/permissions/dependencies.py
from fastapi import Depends, HTTPException, status
from .service import PermissionService, get_permission_service
from src.user.auth.service import get_current_user


class RequireDatabaseRead:
    def __init__(self, name_param: str = "database_name"):
        self.name_param = name_param

    async def __call__(
        self,
        current_user=Depends(get_current_user),
        perm_service: PermissionService = Depends(get_permission_service),
    ):
        async def check(database_name: str):
            if not await perm_service.can_read_database(current_user.id, database_name):
                raise HTTPException(status_code=403, detail=f"无权访问知识库 {database_name}")
        return check


class RequireDatabaseWrite:
    async def __call__(
        self,
        database_name: str,
        current_user=Depends(get_current_user),
        perm_service: PermissionService = Depends(get_permission_service),
    ):
        if not await perm_service.can_write_database(current_user.id, database_name):
            raise HTTPException(status_code=403, detail=f"无权写入知识库 {database_name}")


# 快捷实例
require_db_read = RequireDatabaseRead()
require_db_write = RequireDatabaseWrite()