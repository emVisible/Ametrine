from functools import wraps


def use_database_before(default_db="default"):
    def decorator(func):
        @wraps(func)
        async def wrapper(self, *args, **kwargs):
            database_name = kwargs.get("database_name", default_db)
            self.client.use_database(database_name)
            return await func(self, *args, **kwargs)

        return wrapper

    return decorator
