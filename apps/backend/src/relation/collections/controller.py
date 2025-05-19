from fastapi import APIRouter, Body, Depends
from src.logger import Tags

from .service import CollectionService, get_collection

route_collection = APIRouter(prefix="/collection", tags=[Tags.relation_db])


@route_collection.post("/create", summary="创建Collection")
async def create_collection(
    name: str = Body(..., embed=True),
    database_id: int = Body(..., embed=True),
    description: str = Body(..., embed=True),
    service: CollectionService = Depends(get_collection),
):
    return await service.collection_create_service(
        name=name, database_id=database_id, description=description
    )


@route_collection.get("/all", summary="获取所有Collection名称列表")
async def all(service: CollectionService = Depends(get_collection)):
    return await service.collection_get_all_service()


@route_collection.get("/all/specific", summary="获取指定数据库的Collection名称列表")
async def all_specific(
    database_id: int,
    service: CollectionService = Depends(get_collection),
):
    return await service.collection_get_all_specific_service(database_id=database_id)


@route_collection.get("/get", summary="获取Collection详细信息")
async def get(
    collection_name: str,
    service: CollectionService = Depends(get_collection),
):
    return await service.collection_get_service(name=collection_name)
