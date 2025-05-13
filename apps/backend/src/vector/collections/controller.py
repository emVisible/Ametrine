from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from src.logger import Tags
from src.vector.collections.dto import (
    CollectionRenameDto,
    CollectionBaseDto,
    CollectionUniversalDto,
)
from src.vector.collections.service import CollectionService, get_collection_service

route_vector_collection = APIRouter(prefix="/collection")


@route_vector_collection.post(
    "/details",
    summary="返回当前数据库中所有collection详细信息",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def get(
    dto: CollectionBaseDto,
    service: CollectionService = Depends(get_collection_service),
):
    database_name = dto.database_name
    return await service.collection_get_all_detail_service(database_name=database_name)


@route_vector_collection.post(
    "/all",
    summary="返回所有collection",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def get(
    dto: CollectionBaseDto,
    service: CollectionService = Depends(get_collection_service),
):
    database_name = dto.database_name
    return await service.collection_get_all_service(database_name=database_name)


@route_vector_collection.post(
    "/create",
    summary="创建collection",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def create(
    dto: CollectionUniversalDto,
    service: CollectionService = Depends(get_collection_service),
):
    collection_name = dto.collection_name
    database_name = dto.database_name
    return await service.collection_create_service(
        collection_name=collection_name, database_name=database_name
    )


@route_vector_collection.post(
    "/rename",
    summary="重命名collection",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def rename(
    dto: CollectionRenameDto,
    service: CollectionService = Depends(get_collection_service),
):
    old_name = dto.old_name
    new_name = dto.new_name
    database_name = dto.database_name
    return await service.collection_rename_service(
        old_name=old_name, new_name=new_name, database_name=database_name
    )


@route_vector_collection.post(
    "/get",
    summary="获取Collection详细信息",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def get(
    dto: CollectionUniversalDto,
    service: CollectionService = Depends(get_collection_service),
):
    collection_name = dto.collection_name
    database_name = dto.database_name
    return await service.collection_get_describe_service(
        collection_name=collection_name, database_name=database_name
    )


@route_vector_collection.delete(
    "/delete",
    summary="删除collection",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def delete(
    dto: CollectionUniversalDto,
    service: CollectionService = Depends(get_collection_service),
):
    collection_name = dto.collection_name
    database_name = dto.database_name
    return await service.collection_delete_service(
        collection_name=collection_name, database_name=database_name
    )


@route_vector_collection.post(
    "/reset",
    summary="重置Collection",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def reset(
    dto: CollectionBaseDto,
    service: CollectionService = Depends(get_collection_service),
):
    database_name = dto.database_name
    return await service.collection_reset_service(database_name=database_name)