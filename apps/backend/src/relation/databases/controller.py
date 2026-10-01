from fastapi import APIRouter, Body, Depends, HTTPException
from src.middleware.logger import config_logger
from src.middleware.tags import ControllerTag
from src.utils.names import vector_name_error
from src.vector.databases.service import (
    DatabaseService as VectorDatabaseService,
    get_database_service as get_vector_database_service,
)
from .service import DatabaseService, get_database_service
from src.user.auth.service import get_current_user, get_admin_user
from src.user.permissions.service import PermissionService, get_permission_service

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
    # 0. 名字先过向量库的规则：PG 写得下 `test-db`，Milvus 建不出这个库，
    #    于是得到一个列表里看得见、什么都存不进去的小学库（本机现成就有三个这种行）。
    bad = vector_name_error("知识库", name)
    if bad:
        raise HTTPException(status_code=422, detail=bad)

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
    except Exception as e:  # noqa: BLE001
        # Milvus 失败，回滚 PG
        try:
            await service.database_delete_service(name=name)
        except Exception:  # noqa: BLE001
            config_logger.exception("知识库创建失败后的 PG 回滚也没成功: %s", name)
            raise HTTPException(
                status_code=500,
                detail=(
                    f"向量库创建失败（{type(e).__name__}），且 PG 记录未能回滚："
                    "请到列表里删除这条知识库再重试。"
                ),
            )
        config_logger.error("milvus database create failed for %s: %s", name, str(e)[:300])
        raise HTTPException(
            status_code=502,
            detail=f"向量库创建失败（{type(e).__name__}），PG 记录已回滚，可以直接重试。",
        )

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
    # 顺序：先删向量、后删关系行。原来反过来，并且用 `except: pass` 把向量侧的失败吞掉 ——
    # 于是 Milvus 里留下一个 PG 已经不再引用的孤儿库：列表看不到，也就再也删不掉
    # （集合那一侧已经按这个顺序修过，两个动作是一套口径）。
    if name != "default":
        try:
            await vector_db_service.database_delete_service(db_name=name)
        except Exception as e:  # noqa: BLE001
            config_logger.error("milvus database delete failed for %s: %s", name, str(e)[:300])
            raise HTTPException(
                status_code=502,
                detail=(
                    f"向量库删除失败（{type(e).__name__}），PG 记录未删除，"
                    "可直接重试；PG 里的集合与文档记录仍然完整。"
                ),
            )

    await service.database_delete_service(name=name)

    return {"message": f"Database {name} deleted"}


@route_database.get("/all", summary="获取当前用户可读的 Database 列表")
async def all(
    current_user=Depends(get_current_user),
    service: DatabaseService = Depends(get_database_service),
):
    # 原来任何登录用户都能拿到**全部租户**的知识库名字与描述。
    # 知识库名本身就是信息（「薪酬制度」「并购尽调」），它归权限模型管。
    # 这里直接用 database_get_all_for_user —— 与 can_read_database、概览统计同一个判定函数，
    # 否则又会出现「列表里看得到、提问时却判无权」这类两套口径的分裂。
    return await service.database_get_all_for_user(current_user.id)


@route_database.get("/get", summary="获取Database详细信息")
async def get(
    name: str,
    current_user=Depends(get_current_user),
    perm_service: PermissionService = Depends(get_permission_service),
    service: DatabaseService = Depends(get_database_service),
):
    await perm_service.require_read_database(current_user.id, name)
    return await service.database_get_service(name=name)



@route_database.get("/mine", summary="获取当前用户可访问的数据库")
async def my_databases(
    current_user=Depends(get_current_user),
    service: DatabaseService = Depends(get_database_service),
):
    return await service.database_get_all_for_user(current_user.id)
