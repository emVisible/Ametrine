from fastapi import APIRouter, Depends
from src.middleware.tags import ControllerTag
from src.user.auth.service import get_current_user

from .collections.controller import route_collection
from .databases.controller import route_database
from .documents.controller import route_document
from .tenants.controller import route_tenant

# 整个 relation 面都要带 token：以前 /relation/database/all 与 /collection/all 匿名可读，
# 等于把知识库名、描述、租户名、集合名整份公开。
# 依赖挂在父路由上，include_router 会把它传给每个子路由，不用逐个端点补。
route_relation = APIRouter(
    prefix="/relation",
    tags=[ControllerTag.relation_db],
    dependencies=[Depends(get_current_user)],
)
route_relation.include_router(route_collection)
route_relation.include_router(route_tenant)
route_relation.include_router(route_database)
route_relation.include_router(route_document)
