from fastapi import APIRouter, Depends
from src.base.database import reset_db
from src.logger import Tags
from src.utils import require_roles

from .service import InitService

route_init = APIRouter(prefix="/init")


@route_init.post(
    "/table",
    summary="[初始化] 初始化数据库",
    tags=[Tags.init],
)
async def init_table_user(
    service: InitService = Depends(InitService),
):
    await reset_db()
    await service.db_init()
    return "初始化成功"


@route_init.post(
    "/test",
    summary="admin权限测试",
    tags=[Tags.init],
)
async def test(
    user=Depends(require_roles(["admin"])),
):
    return "ok"
