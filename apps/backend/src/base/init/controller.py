from fastapi import APIRouter
from fastapi import status, Depends
from src.logger import Tags
from src.base.database import get_db, reset_db
from sqlalchemy.orm import Session
from .service import InitService

route_init = APIRouter(prefix="/init")


@route_init.post(
    "/table",
    summary="[初始化] 初始化数据库",
    status_code=status.HTTP_200_OK,
    response_description="返回是否成功",
    tags=[Tags.init],
)
async def init_table_user(
    service: InitService = Depends(InitService),
):
    await reset_db()
    await service.db_init()
    return "初始化成功"
