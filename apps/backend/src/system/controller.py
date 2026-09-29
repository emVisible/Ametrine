from fastapi import APIRouter, Depends

from src.middleware.tags import ControllerTag
from src.user.auth.service import get_current_user, is_admin
from .service import SystemService, get_system_service

# 概览是登录后的首屏，而且会把依赖服务连接失败的具体异常带进响应 —— 不给匿名。
# 根路径上那个 /health 是给外部探针用的，前端只代理 /api，界面拿不到它。
route_system = APIRouter(
    prefix="/system",
    tags=[ControllerTag.dev],
    dependencies=[Depends(get_current_user)],
)


@route_system.get("/overview", summary="概览：规模、索引健康度、入库活动与依赖就绪度")
async def overview(
    current_user=Depends(get_current_user),
    service: SystemService = Depends(get_system_service),
):
    return await service.overview(
        user_id=current_user.id, is_admin=is_admin(current_user)
    )
