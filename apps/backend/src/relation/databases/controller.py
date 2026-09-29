from fastapi import APIRouter, Body, Depends, HTTPException
from src.middleware.tags import ControllerTag
from src.vector.databases.service import (
    DatabaseService as VectorDatabaseService,
    get_database_service as get_vector_database_service,
)
from .service import DatabaseService, get_database_service
from src.user.auth.service import get_current_user, get_admin_user

route_database = APIRouter(prefix="/database", tags=[ControllerTag.relation_db])


@route_database.post(
    "/create",
    summary="创建Database（PG → Milvus 同步）",
    dependencies=[Depends(get_admin_user)],
)
async def create(
    name: str = Body(..., embed=True),
    description: str = Body(..., embed=True),
    tenant_id: int = Body(None, embed=True),
    service: DatabaseService = Depends(get_database_service),
    vector_db_service: VectorDatabaseService = Depends(get_vector_database_service),
):
    # 1. 先写 PG
    result = await service.database_create_service(
        name=name, description=description, tenant_id=tenant_id
    )

    # 2. 同步到 Milvus
    try:
        await vector_db_service.create_database_service(
            db_name=name,
            tenant_name="default",
            replica_number=1,
            description=description,
        )
    except Exception as e:
        # Milvus 失败，回滚 PG
        await service.database_delete_service(name=name)
        raise HTTPException(status_code=500, detail=f"Milvus 同步失败: {e}")

    return result


@route_database.delete(
    "/delete",
    summary="删除Database（PG → Milvus 同步）",
    dependencies=[Depends(get_admin_user)],
)
async def delete(
    name: str = Body(..., embed=True),
    service: DatabaseService = Depends(get_database_service),
    vector_db_service: VectorDatabaseService = Depends(get_vector_database_service),
):
    # 1. 先删 PG
    await service.database_delete_service(name=name)

    # 2. 同步删 Milvus
    if name != "default":
        try:
            await vector_db_service.database_delete_service(db_name=name)
        except Exception:
            pass

    return {"message": f"Database {name} deleted"}


@route_database.get("/all", summary="获取所有Database名称列表")
async def all(service: DatabaseService = Depends(get_database_service)):
    return await service.database_get_all_service()


@route_database.get("/get", summary="获取Database详细信息")
async def get(name: str, service: DatabaseService = Depends(get_database_service)):
    return await service.database_get_service(name=name)



@route_database.get("/mine", summary="获取当前用户可访问的数据库")
async def my_databases(
    current_user=Depends(get_current_user),
    service: DatabaseService = Depends(get_database_service),
):
    return await service.database_get_all_for_user(current_user.id)
