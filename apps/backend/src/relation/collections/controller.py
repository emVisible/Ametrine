# src/relation/collections/controller.py
from fastapi import APIRouter, Body, Depends, HTTPException
from src.middleware.logger import config_logger
from src.middleware.tags import ControllerTag
from src.user.auth.service import get_admin_user, get_current_user
from src.user.permissions.service import PermissionService, get_permission_service
from src.relation.databases.service import DatabaseService, get_database_service
from src.utils.names import vector_name_error
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

    # 0. 名字先过向量库的规则，再谈写库。
    #    这一步不能省：`collection_create_service` 里是 `commit()`，PG 先落地、Milvus 后同步，
    #    所以一个 Milvus 不接受的名字（带 `-` 就行）会留下一条**永远检索不到**的记录 ——
    #    本机现成就有一条 `faman-collection`，界面上列得出来，问一句话是 500。
    bad = vector_name_error("集合", name)
    if bad:
        raise HTTPException(status_code=422, detail=bad)

    # 2. 先写 PG
    result = await service.collection_create_service(
        name=name, database_id=database_id, description=description
    )

    # 3. 同步到 Milvus。失败必须把第 2 步撤掉：留下的那行既删不掉向量（本来就没有）、
    #    又在列表里一直冒充一个可用的小学库。database/create 早就是这么写的，
    #    这一处原先只留了一句「需要给 collection service 加个 delete 方法」的注释 ——
    #    而那个方法早就存在（本文件的删除端点在用）。
    try:
        await vector_collection_service.collection_create_service(
            collection_name=name,
            database_name=db_name,
            description=description,
        )
    except Exception as e:  # noqa: BLE001
        try:
            await service.collection_delete_service(name=name)
        except Exception:  # noqa: BLE001
            # 回滚本身失败要喊，但不能盖掉真正的原因（那才是用户能修的东西）
            config_logger.exception("集合创建失败后的 PG 回滚也没成功: %s", name)
            raise HTTPException(
                status_code=500,
                detail=(
                    f"向量集合创建失败（{type(e).__name__}），"
                    "且 PG 记录未能回滚：请到列表里删除这条集合再重试。"
                ),
            )
        # 细节只进日志：Milvus 的异常原文里可能带内部路径与配置。
        config_logger.error("collection create failed for %s: %s", name, str(e)[:300])
        raise HTTPException(
            status_code=502,
            detail=f"向量集合创建失败（{type(e).__name__}），PG 记录已回滚，可以直接重试。",
        )

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


@route_collection.get("/all", summary="获取当前用户可读库下的 Collection 列表")
async def all(
    current_user=Depends(get_current_user),
    perm_service: PermissionService = Depends(get_permission_service),
    service: CollectionService = Depends(get_collection_service),
):
    # 管理员拿到的是全量 id，所以这条路对两种身份只有一份语义（不是两个分支两套规则）
    ids = [db["id"] for db in await perm_service.get_accessible_databases(current_user.id)]
    return await service.collection_get_all_service(database_ids=ids)


@route_collection.get("/all/specific", summary="获取指定数据库的Collection名称列表")
async def all_specific(
    database_id: int,
    current_user=Depends(get_current_user),
    perm_service: PermissionService = Depends(get_permission_service),
    service: CollectionService = Depends(get_collection_service),
):
    ids = [db["id"] for db in await perm_service.get_accessible_databases(current_user.id)]
    if database_id not in ids:
        raise HTTPException(status_code=403, detail="您无权访问该知识库")
    return await service.collection_get_all_specific_service(database_id=database_id)


@route_collection.get("/get", summary="获取Collection详细信息")
async def get(
    collection_name: str,
    current_user=Depends(get_current_user),
    perm_service: PermissionService = Depends(get_permission_service),
    service: CollectionService = Depends(get_collection_service),
):
    # 这是 /relation/** 读面上最后一个不判库级权限的端点：
    # 集合名能枚举出来，就等于把别人的知识库结构读走了。
    database_name = await service.collection_database_name_service(name=collection_name)
    if database_name is None:
        raise HTTPException(status_code=404, detail="集合不存在")
    await perm_service.require_read_database(current_user.id, database_name)
    return await service.collection_get_service(name=collection_name)