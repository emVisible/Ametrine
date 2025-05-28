from operator import attrgetter

from fastapi import APIRouter, Depends
from src.middleware.tags import ControllerTag
from src.relation.service import RelationService, get_relation_service

from .dto import DatabaseCreateDto, DatabaseUniversalDto
from .service import DatabaseService, get_database_service

route_vector_database = APIRouter(prefix="/database", tags=[ControllerTag.vector_db])


@route_vector_database.get("/all", summary="获取Database名称列表")
async def all(service: DatabaseService = Depends(get_database_service)):
    return await service.database_get_all_service()


@route_vector_database.get("/details", summary="获取Database详细信息")
async def details(service: DatabaseService = Depends(get_database_service)):
    return await service.database_get_all_detail_service()


@route_vector_database.post("/create", summary="创建Database")
async def create(
    dto: DatabaseCreateDto,
    service: DatabaseService = Depends(get_database_service),
    relation_service: RelationService = Depends(get_relation_service),
):
    db_name, tenant_name, replica_number, description = attrgetter(
        "db_name", "tenant_name", "replica_number", "description"
    )(dto)
    await relation_service.tenantService.create_tenant(
        name=tenant_name, database_name=db_name, database_description=description
    )
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


@route_vector_database.delete("/delete", summary="删除database")
async def delete(
    dto: DatabaseUniversalDto,
    service: DatabaseService = Depends(get_database_service),
    relation_service: RelationService = Depends(get_relation_service),
):
    db_name = dto.db_name
    db = await relation_service.databaseService.database_get_service(name=db_name)
    await relation_service.tenantService.delete_tenant(name=db.tenant.name)
    return await service.database_delete_service(db_name=db_name)


@route_vector_database.post("/reset", summary="重置Database")
async def reset(service: DatabaseService = Depends(get_database_service)):
    return await service.database_reset_service()
