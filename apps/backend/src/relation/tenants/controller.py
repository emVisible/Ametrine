from fastapi import APIRouter, Body, Depends
from src.middleware.tags import ControllerTag

from .service import TenantService, get_tenant_service

route_tenant = APIRouter(prefix="/tenant", tags=[ControllerTag.relation_db])


@route_tenant.post("/create", summary="创建Tenant")
async def create_tenant(
    name: str = Body(..., embed=True),
    database: str = Body(..., embed=True),
    description: str = Body(..., embed=True),
    service: TenantService = Depends(get_tenant_service),
):
    return await service.create_tenant(
        name=name, database_name=database, database_description=description
    )


@route_tenant.get("/all", summary="获取所有Tenant名称列表")
async def get_all_tenants(service: TenantService = Depends(get_tenant_service)):
    return await service.get_all_tenants()


@route_tenant.get("/get", summary="获取Tenant详细信息")
async def get_tenant_detail(
    name: str, service: TenantService = Depends(get_tenant_service)
):
    return await service.get_tenant_by_name(name)
