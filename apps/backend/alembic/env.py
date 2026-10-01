# alembic/env.py
import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.ext.asyncio import create_async_engine
from alembic import context

from src.config import postgre_addr
from src.models import Base  # 你的所有模型

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline():
    # 原来是 config.get_main_option("sqlalchemy.url")：那条只存在于 alembic.ini，
    # 而它写死的是某一台开发机的 postgres:preview@localhost。于是 README 教的
    # `alembic upgrade head` 连的根本不是 .env 里那个库 —— 换口令的人要么连不上，
    # 要么把迁移打在别的库上。DSN 现在只有一个来源：应用读的 POSTGRE_ADDR。
    context.configure(
        url=postgre_addr,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection):
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations():
    connectable = create_async_engine(postgre_addr, poolclass=pool.NullPool)
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online():
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
