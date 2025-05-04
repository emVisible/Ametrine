from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from src.logger import Tags

from .dto import DatabaseCreateDto, DatabaseUniversalDto
from .service import DatabaseService, get_database_service

# Milvus 连接设置
route_vector_database = APIRouter(prefix="/database")


@route_vector_database.get(
    "/all",
    summary="获取Database详细信息",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def all(service: DatabaseService = Depends(get_database_service)):
    return await service.database_get_all_service()


@route_vector_database.post(
    "/create",
    summary="创建Database",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def create(
    dto: DatabaseCreateDto,
    service: DatabaseService = Depends(get_database_service),
):
    db_name = dto.db_name
    tenant_name = dto.tenant_name
    replica_number = dto.replica_number
    return await service.create_database_service(
        db_name=db_name, tenant_name=tenant_name, replica_number=replica_number
    )


@route_vector_database.post(
    "/get",
    summary="获取Database详细信息",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def get(
    dto: DatabaseUniversalDto,
    service: DatabaseService = Depends(get_database_service),
):
    db_name = dto.db_name
    return await service.database_get_describe_service(db_name=db_name)


@route_vector_database.delete(
    "/delete",
    summary="删除database",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def delete(
    dto: DatabaseUniversalDto, service: DatabaseService = Depends(get_database_service)
):
    db_name = dto.db_name
    return await service.database_delete_service(db_name=db_name)


@route_vector_database.post(
    "/reset",
    summary="重置Database",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def reset(service: DatabaseService = Depends(get_database_service)):
    return await service.database_reset_service()
