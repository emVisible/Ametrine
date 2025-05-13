from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.exc import SQLAlchemyError

from ..logger import Tags
from .service import TenantService, get_tenant_service

route_relation = APIRouter(prefix="/relation", tags=[Tags.relation_db])


@route_relation.post(
    "/tenant/create",
    summary="创建租户",
)
async def create_tenant(
    name: str = Body(..., embed=True),
    database: str = Body(..., embed=True),
    service: TenantService = Depends(get_tenant_service),
):
    try:
        return await service.create_tenant(name=name, database=database)
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@route_relation.get(
    "/tenant/all",
    summary="获取所有租户",
)
async def get_all_tenants(
    service: TenantService = Depends(get_tenant_service),
):
    try:
        return await service.get_all_tenants()
    except SQLAlchemyError as e:
        raise HTTPException(status_code=500, detail=str(e))


@route_relation.post(
    "/tenant/get",
    summary="获取指定租户信息",
)
async def get_tenant_detail(
    name: str = Body(..., embed=True),
    service: TenantService = Depends(get_tenant_service),
):
    tenant = await service.get_tenant_by_name(name)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return tenant
