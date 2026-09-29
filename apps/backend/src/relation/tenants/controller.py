from fastapi import APIRouter, Body, Depends, HTTPException
from src.middleware.tags import ControllerTag
from src.user.auth.service import get_admin_user
from .service import TenantService, get_tenant_service

# 租户是隔离边界，不是个人资源：建/删租户、增删成员都会改变别人能看到什么。
# 读只要登录（父路由 /relation 已挂 get_current_user），写在这里逐条收紧到管理员。
route_tenant = APIRouter(prefix="/tenant", tags=[ControllerTag.relation_db])


@route_tenant.post("/create", summary="创建Tenant", dependencies=[Depends(get_admin_user)])
async def create_tenant(
    name: str = Body(..., embed=True),
    service: TenantService = Depends(get_tenant_service),
):
    return await service.create_tenant(name=name)


@route_tenant.get("/all", summary="获取所有Tenant")
async def get_all_tenants(service: TenantService = Depends(get_tenant_service)):
    return await service.get_all_tenants()


@route_tenant.get(
    "/overview",
    summary="租户×成员×知识库总览（一次请求）",
    dependencies=[Depends(get_admin_user)],
)
async def get_tenant_overview(service: TenantService = Depends(get_tenant_service)):
    return await service.get_overview()


@route_tenant.get("/{tenant_id}", summary="获取指定Tenant")
async def get_tenant(
    tenant_id: int,
    service: TenantService = Depends(get_tenant_service),
):
    tenant = await service.get_tenant_by_id(tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return tenant


@route_tenant.post("/search", summary="搜索Tenant")
async def search_tenant(
    value: str = Body(..., embed=True),
    service: TenantService = Depends(get_tenant_service),
):
    return await service.search_tenants(value)


@route_tenant.delete(
    "/{tenant_id}", summary="删除Tenant", dependencies=[Depends(get_admin_user)]
)
async def delete_tenant(
    tenant_id: int,
    service: TenantService = Depends(get_tenant_service),
):
    return await service.delete_tenant(tenant_id)


@route_tenant.get("/{tenant_id}/members", summary="获取租户成员")
async def get_members(
    tenant_id: int,
    service: TenantService = Depends(get_tenant_service),
):
    return await service.get_members(tenant_id)


@route_tenant.post(
    "/{tenant_id}/members/{user_id}",
    summary="添加成员",
    dependencies=[Depends(get_admin_user)],
)
async def add_member(
    tenant_id: int,
    user_id: int,
    role: str = Body("member", embed=True),
    service: TenantService = Depends(get_tenant_service),
):
    return await service.add_member(tenant_id, user_id, role)


@route_tenant.delete(
    "/{tenant_id}/members/{user_id}",
    summary="移除成员",
    dependencies=[Depends(get_admin_user)],
)
async def remove_member(
    tenant_id: int,
    user_id: int,
    service: TenantService = Depends(get_tenant_service),
):
    return await service.remove_member(tenant_id, user_id)
