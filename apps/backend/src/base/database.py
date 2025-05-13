from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.ext.declarative import declarative_base

"""
  Change this into your postgresql database config.
  SQLAlchemy_DB = "postgresql+asyncpg://{username}:{password}@localhost:5432/{dbname}"
"""
SQLAlchemy_DB = "postgresql+asyncpg://postgres:review@localhost:5432/ametrine"
engine = create_async_engine(SQLAlchemy_DB, echo=True)
async_session = async_sessionmaker(engine, expire_on_commit=False)

Base = declarative_base()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        yield session


async def reset_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)