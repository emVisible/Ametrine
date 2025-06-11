from inspect import isawaitable
from functools import wraps
from typing import List

from fastapi import Depends
from src.base.auth.service import get_current_user, permission_map
from src.middleware.exceptions import ForbiddenException



async def maybe_await(func_result):
    if isawaitable(func_result):
        return await func_result
    return func_result


def use_vector_database(default_db="default"):
    def decorator(func):
        @wraps(func)
        async def wrapper(self, *args, **kwargs):
            database_name = kwargs.get("database_name", default_db)
            self.milvus_service.use_database(database_name)
            return await func(self, *args, **kwargs)

        return wrapper

    return decorator


def require_roles(roles: List[str]):
    async def _inner(current_user=Depends(get_current_user)):
        user_roles = await maybe_await(permission_map(current_user.role_id))
        if not any(role in user_roles for role in roles):
            raise ForbiddenException()
        return current_user

    return _inner


