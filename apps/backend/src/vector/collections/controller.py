from operator import attrgetter

from fastapi import APIRouter, Depends
from src.middleware.tags import ControllerTag
from src.relation.service import RelationService, get_relation_service
from src.vector.collections.dto import (
    CollectionBaseDto,
    CollectionCreateDto,
    CollectionRenameDto,
    CollectionUniversalDto,
)
from src.vector.collections.service import CollectionService, get_collection_service

route_vector_collection = APIRouter(
    prefix="/collection", tags=[ControllerTag.vector_db]
)


@route_vector_collection.post(
    "/details",
    summary="返回当前数据库中所有collection详细信息",
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
)
async def create(
    dto: CollectionCreateDto,
    service: CollectionService = Depends(get_collection_service),
    relation_service: RelationService = Depends(get_relation_service),
):

    collection_name, database_name, description = attrgetter(
        "collection_name", "database_name", "description"
    )(dto)
    db = await relation_service.databaseService.database_get_service(name=database_name)
    await relation_service.collectionService.collection_create_service(
        name=collection_name, database_id=db.id, description=description
    )
    return await service.collection_create_service(
        collection_name=collection_name,
        database_name=database_name,
        description=description,
    )


@route_vector_collection.post(
    "/rename",
    summary="重命名collection",
)
async def rename(
    dto: CollectionRenameDto,
    service: CollectionService = Depends(get_collection_service),
):
    old_name, new_name, database_name = attrgetter(
        "old_name", "new_name", "database_name"
    )(dto)
    return await service.collection_rename_service(
        old_name=old_name, new_name=new_name, database_name=database_name
    )


@route_vector_collection.post(
    "/get",
    summary="获取Collection详细信息",
)
async def get(
    dto: CollectionUniversalDto,
    service: CollectionService = Depends(get_collection_service),
):
    collection_name, database_name = attrgetter("collection_name", "database_name")(dto)
    return await service.collection_get_describe_service(
        collection_name=collection_name, database_name=database_name
    )


@route_vector_collection.delete(
    "/delete",
    summary="删除collection",
)
async def delete(
    dto: CollectionUniversalDto,
    service: CollectionService = Depends(get_collection_service),
):
    collection_name, database_name = attrgetter("collection_name", "database_name")(dto)
    return await service.collection_delete_service(
        collection_name=collection_name, database_name=database_name
    )


@route_vector_collection.post("/reset", summary="重置Collection")
async def reset(
    dto: CollectionBaseDto,
    service: CollectionService = Depends(get_collection_service),
):
    database_name = dto.database_name
    return await service.collection_reset_service(database_name=database_name)


@route_vector_collection.post("/reset/all", summary="重置所有Collection")
async def reset(
    service: CollectionService = Depends(get_collection_service),
):
    return await service.collection_reset_all_service()
