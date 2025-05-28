from fastapi import APIRouter, Depends
from src.client import reset_relation_db
from src.middleware.tags import ControllerTag
from src.utils import require_roles

from .service import InitService, get_init_service

route_init = APIRouter(prefix="/init", tags=[ControllerTag.init])


@route_init.post("/table", summary="[初始化] 初始化数据库")
async def init_table_user(
    service: InitService = Depends(get_init_service),
):
    await reset_relation_db()
    await service.db_init()
    return "初始化成功"


@route_init.post("/test", summary="[测试] admin权限测试")
async def test(
    user=Depends(require_roles(["admin"])),
):
    return "ok"
