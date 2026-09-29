from fastapi import APIRouter, Depends
from src.user.auth.service import get_current_user
from src.user.permissions.service import PermissionService, get_permission_service
from src.middleware.tags import ControllerTag

from ..service import VectorService, get_vector_service
from .dto import DocumentQueryServiceDto

route_vector_document = APIRouter(prefix="/document", tags=[ControllerTag.vector_db])


@route_vector_document.post("/search", summary="向量检索原始结果")
async def document_search(
    dto: DocumentQueryServiceDto,
    # 这里原来是 `document_query_service(dto)`：整个 DTO 当成第一个位置参数传进去，
    # 于是 dto 落在 database_name 上、collection_name 与 data 干脆没给，
    # 这个端点从合并进路由那天起就必然 500（装饰器还会拿 dto 当库名去 use_database）。
    # 顺带补上库级读权限：父路由只有「登录」这一道，任何登录用户都能搜任意租户的集合。
    current_user=Depends(get_current_user),
    perm_service: PermissionService = Depends(get_permission_service),
    vector_service: VectorService = Depends(get_vector_service),
):
    await perm_service.require_read_database(current_user.id, dto.database_name)
    return await vector_service.document_service.document_query_service(
        database_name=dto.database_name,
        collection_name=dto.collection_name,
        data=dto.data,
        limit=dto.limit,
    )
