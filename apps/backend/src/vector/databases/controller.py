from operator import attrgetter

from fastapi import APIRouter, Body, Depends, HTTPException
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
    "/reset",
    summary=(
        "重置 Database：**删掉向量库里除 default 之外的每一个库**（= 全部已入库文档的向量）。"
        "必须显式带 confirm 字符串，缺或错都回 422。"
    ),
    dependencies=[Depends(get_admin_user)],
)
async def reset(
    confirm: str = Body(..., embed=True),
    service: DatabaseService = Depends(get_database_service),
):
    # 这个端点原本只要一个管理员依赖、不带任何确认，一个 POST 就把整台机器的向量数据清空。
    # 删掉整条路由是最干净的（前端没有任何地方调用它），但那是在替用户做一个产品决定；
    # 这里先把「手滑」这条路堵死：要毁数据就得把这串字符原样发过来。
    if confirm != "DROP-ALL-VECTOR-DATABASES":
        raise HTTPException(
            status_code=422,
            detail=(
                "这是一个不可逆操作：它会删掉向量库里除 default 之外的所有库，"
                "已入库文档的向量随之全部失效，而本机现状是**原文已丢失、重建不了**"
                "（见交接文档 §5.0）。确认要执行就把 confirm 填成 "
                "DROP-ALL-VECTOR-DATABASES。"
            ),
        )
    return await service.database_reset_service()
