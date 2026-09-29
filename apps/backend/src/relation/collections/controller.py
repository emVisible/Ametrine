# src/relation/collections/controller.py
from fastapi import APIRouter, Body, Depends, HTTPException
from src.middleware.tags import ControllerTag
from src.user.auth.service import get_admin_user
from src.relation.databases.service import DatabaseService, get_database_service
from src.vector.collections.service import CollectionService as VectorCollectionService, get_collection_service as get_vector_collection_service
from .service import CollectionService, get_collection_service

route_collection = APIRouter(prefix="/collection", tags=[ControllerTag.relation_db])


@route_collection.post(
    "/create",
    summary="创建Collection（PG → Milvus 同步）",
    dependencies=[Depends(get_admin_user)],
)
async def create_collection(
    name: str = Body(..., embed=True),
    database_id: int = Body(..., embed=True),
    description: str = Body(..., embed=True),
    service: CollectionService = Depends(get_collection_service),
    db_service: DatabaseService = Depends(get_database_service),
    vector_collection_service: VectorCollectionService = Depends(get_vector_collection_service),
):
    # 1. 查 PG 里 database 的名字（Milvus 需要 db_name）
    db_name = await db_service.database_get_by_id_service(db_id=database_id)
    if not db_name:
        raise HTTPException(status_code=404, detail="Database not found")

    # 2. 先写 PG
    result = await service.collection_create_service(
        name=name, database_id=database_id, description=description
    )

    # 3. 同步到 Milvus
    try:
        await vector_collection_service.collection_create_service(
            collection_name=name,
            database_name=db_name,
            description=description,
        )
    except Exception as e:
        # Milvus 失败，回滚 PG（需要给 collection service 加个 delete 方法）
        raise HTTPException(status_code=500, detail=f"Milvus 同步失败: {e}")

    return result


@route_collection.delete(
    "/delete",
    summary="删除Collection（PG → Milvus 同步）",
    dependencies=[Depends(get_admin_user)],
)
async def delete_collection(
    collection_name: str = Body(..., embed=True),
    database_name: str = Body(..., embed=True),
    service: CollectionService = Depends(get_collection_service),
    vector_collection_service: VectorCollectionService = Depends(get_vector_collection_service),
):
    # 顺序和删除文档一致：先删向量、后删关系行。
    # 原来先删 PG 再用 `except: pass` 吞掉 Milvus 的失败 ——
    # 于是 Milvus 里留下一堆 PG 已经不再引用的孤儿集合，
    # 界面看不到、也再也删不掉（删除入口查的是 PG）。
    try:
        await vector_collection_service.collection_delete_service(
            collection_name=collection_name,
            database_name=database_name,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail=f"向量集合删除失败，PG 记录未删除，可直接重试：{type(exc).__name__}",
        )

    await service.collection_delete_service(name=collection_name)

    return {"message": f"Collection {collection_name} deleted"}


@route_collection.get("/all", summary="获取所有Collection名称列表")
async def all(service: CollectionService = Depends(get_collection_service)):
    return await service.collection_get_all_service()


@route_collection.get("/all/specific", summary="获取指定数据库的Collection名称列表")
async def all_specific(
    database_id: int,
    service: CollectionService = Depends(get_collection_service),
):
    return await service.collection_get_all_specific_service(database_id=database_id)


@route_collection.get("/get", summary="获取Collection详细信息")
async def get(
    collection_name: str,
    service: CollectionService = Depends(get_collection_service),
):
    return await service.collection_get_service(name=collection_name)