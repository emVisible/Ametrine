from fastapi import APIRouter, Body, Depends
from src.logger import Tags

from .service import DatabaseService, get_database

route_database = APIRouter(prefix="/database", tags=[Tags.relation_db])


@route_database.post("/create", summary="创建Database")
async def create(
    name: str = Body(..., embed=True),
    description: str = Body(..., embed=True),
    service: DatabaseService = Depends(get_database),
):
    return await service.database_create_service(name=name, description=description)


@route_database.get("/all", summary="获取所有Database名称列表")
async def all(service: DatabaseService = Depends(get_database)):
    return await service.database_get_all_service()


@route_database.get("/get", summary="获取Database详细信息")
async def get(name: str, service: DatabaseService = Depends(get_database)):
    return await service.database_get_service(name=name)
