from operator import attrgetter

from fastapi import APIRouter, Depends
from src.middleware.tags import ControllerTag
from src.user.auth.service import get_admin_user

from .dto import DatabaseCreateDto, DatabaseUniversalDto
from .service import DatabaseService, get_database_service

route_vector_database = APIRouter(prefix="/database", tags=[ControllerTag.vector_db])


@route_vector_database.get("/all", summary="获取Database名称列表")
async def all(service: DatabaseService = Depends(get_database_service)):
    return await service.database_get_all_service()


@route_vector_database.get("/details", summary="获取Database详细信息")
async def details(service: DatabaseService = Depends(get_database_service)):
    return await service.database_get_all_detail_service()


@route_vector_database.post(
    "/create", summary="创建Database（仅 Milvus 侧）", dependencies=[Depends(get_admin_user)]
)
async def create(
    dto: DatabaseCreateDto,
    service: DatabaseService = Depends(get_database_service),
):
    # 这里原来还调用 relation_service.tenantService.create_tenant(
    #     name=..., database_name=..., database_description=...
    # )，而 TenantService.create_tenant 只接受 name —— 每次请求必然 TypeError 500。
    # 「建租户 + 建 PG 库 + 同步 Milvus」是 /relation/database/create 的职责，
    # 本端点只负责 Milvus 一侧，两条路径不再互相渗透。
    db_name, tenant_name, replica_number, description = attrgetter(
        "db_name", "tenant_name", "replica_number", "description"
    )(dto)
    return await service.create_database_service(
        db_name=db_name,
        tenant_name=tenant_name,
        replica_number=replica_number,
        description=description,
    )


@route_vector_database.post("/get", summary="获取Database详细信息")
async def get(
    dto: DatabaseUniversalDto,
    service: DatabaseService = Depends(get_database_service),
):
    db_name = dto.db_name
    return await service.database_get_describe_service(db_name=db_name)


@route_vector_database.delete(
    "/delete",
    summary="删除database（仅 Milvus 侧）",
    dependencies=[Depends(get_admin_user)],
)
async def delete(
    dto: DatabaseUniversalDto,
    service: DatabaseService = Depends(get_database_service),
):
    # 原来这里 database_get_service() 拿到的是 dict，却按 ORM 写 db.tenant.name → AttributeError；
    # 而且 PG 侧的租户/库记录由 /relation/database/delete 负责，本端点不该越界。
    return await service.database_delete_service(db_name=dto.db_name)


@route_vector_database.post(
    "/reset", summary="重置Database", dependencies=[Depends(get_admin_user)]
)
async def reset(service: DatabaseService = Depends(get_database_service)):
    return await service.database_reset_service()
