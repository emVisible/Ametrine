from functools import wraps
from fastapi import Depends, HTTPException, status
from .service import PermissionService, get_permission_service
from src.user.auth.service import get_current_user


def require_database_access(
    database_name_param: str = "database_name", require_write: bool = False
):
    """检查当前用户是否有数据库访问权限"""

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            current_user = kwargs.get("current_user")
            if not current_user:
                raise HTTPException(status_code=401, detail="未认证")

            database_name = kwargs.get(database_name_param)
            if not database_name:
                raise HTTPException(status_code=400, detail="缺少数据库参数")

            perm_service = kwargs.get("perm_service")
            if not perm_service:
                raise HTTPException(status_code=500, detail="权限服务未注入")

            has_access = await perm_service.check_access(
                current_user.id, database_name, require_write
            )
            if not has_access:
                raise HTTPException(
                    status_code=403, detail=f"无权访问数据库 {database_name}"
                )

            return await func(*args, **kwargs)

        return wrapper

    return decorator
