from fastapi import APIRouter, Depends, File, UploadFile, status, Form
from src.utils import Tags
from src.vector.dto import (
    CollectionRenameDto,
    DocumentQueryServiceDto,
    CollectionCreateDto,
)
from .service import CollectionService, EmbeddingService


# Milvus 连接设置
route_vector_milvus = APIRouter(prefix="/vector")


@route_vector_milvus.get(
    "/collections",
    summary="[Vector Database] 返回所有collection",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def get_collections(service: CollectionService = Depends(CollectionService)):
    return await service.collection_get_all_service()


@route_vector_milvus.post(
    "/collection/create",
    summary="[Vector Database] 创建collection",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def create_collection(
    dto: CollectionCreateDto, service: CollectionService = Depends(CollectionService)
):
    return await service.collection_create_service(dto)


@route_vector_milvus.post(
    "/collection/rename",
    summary="[Vector Database] 重命名collection",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def rename_collection(
    dto: CollectionRenameDto, service: CollectionService = Depends(CollectionService)
):
    return await service.collection_rename_service(dto)


@route_vector_milvus.get(
    "/collection",
    summary="[Vector Database] 获取Collection详细信息",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def get_collection(
    collection_name: str, service: CollectionService = Depends(CollectionService)
):
    return await service.collection_get_describe_service(collection_name)


@route_vector_milvus.delete(
    "/collection/delete",
    summary="[Vector Database] 删除collection",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def delete_collection(
    collection_name: str, service: CollectionService = Depends(CollectionService)
):
    return await service.collection_delete_service(collection_name)


@route_vector_milvus.post(
    "/collection/reset",
    summary="[Vector Database] 重置Collection",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def get_collection(service: CollectionService = Depends(CollectionService)):
    return await service.collection_reset_service()


@route_vector_milvus.post(
    "/upload_single",
    summary="[Vector] 根据单一文档转换为矢量",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def upload_single(
    collection_name: str = Form(...),
    database: str = Form(default="default"),
    file: UploadFile = File(...),
    service: EmbeddingService = Depends(EmbeddingService),
):
    return await service.document_upload_service(
        collection_name=collection_name, database=database, file=file
    )


@route_vector_milvus.post(
    "/collections/search",
    summary="[Vector Database] 返回文档详情",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def document_search(
    dto: DocumentQueryServiceDto, service: EmbeddingService = Depends(EmbeddingService)
):
    result = await service.document_query_service(dto)
    return {"status": "success", "data": result}
