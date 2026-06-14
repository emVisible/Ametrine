from fastapi import APIRouter, Body, Depends, HTTPException
from src.middleware.tags import ControllerTag
from .service import TenantService, get_tenant_service

route_tenant = APIRouter(prefix="/tenant", tags=[ControllerTag.relation_db])


@route_tenant.post("/create", summary="创建Tenant")
async def create_tenant(
    name: str = Body(..., embed=True),
    service: TenantService = Depends(get_tenant_service),
):
    return await service.create_tenant(name=name)


@route_tenant.get("/all", summary="获取所有Tenant")
async def get_all_tenants(service: TenantService = Depends(get_tenant_service)):
    return await service.get_all_tenants()


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


@route_tenant.delete("/{tenant_id}", summary="删除Tenant")
async def delete_tenant(
    tenant_id: int,
    service: TenantService = Depends(get_tenant_service),
):
    return await service.delete_tenant(tenant_id)
