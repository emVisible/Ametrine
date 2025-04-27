from fastapi import APIRouter, Depends, File, UploadFile, status, Form
from src.utils import Tags
from src.vector.collections.dto import (
    CollectionRenameDto,
    CollectionCreateDto,
)
from src.vector.collections.service import get_collection_service, CollectionService

route_vector_collection = APIRouter(prefix="/collection")


@route_vector_collection.get(
    "/all",
    summary="返回所有collection",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def get_collections(service: CollectionService = Depends(get_collection_service)):
    return await service.collection_get_all_service()


@route_vector_collection.post(
    "/create",
    summary="创建collection",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def create_collection(
    dto: CollectionCreateDto,
    service: CollectionService = Depends(get_collection_service),
):
    return await service.collection_create_service(dto)


@route_vector_collection.post(
    "/rename",
    summary="重命名collection",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def rename_collection(
    dto: CollectionRenameDto,
    service: CollectionService = Depends(get_collection_service),
):
    return await service.collection_rename_service(dto)


@route_vector_collection.get(
    "/get",
    summary="获取Collection详细信息",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def get_collection(
    collection_name: str, service: CollectionService = Depends(get_collection_service)
):
    return await service.collection_get_describe_service(collection_name)


@route_vector_collection.delete(
    "/delete",
    summary="删除collection",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def delete_collection(
    collection_name: str, service: CollectionService = Depends(get_collection_service)
):
    return await service.collection_delete_service(collection_name)


@route_vector_collection.post(
    "/reset",
    summary="重置Collection",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def get_collection(service: CollectionService = Depends(get_collection_service)):
    return await service.collection_reset_service()
