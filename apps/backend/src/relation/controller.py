from fastapi import APIRouter

from ..logger import Tags
from .collections.controller import route_collection
from .databases.controller import route_database
from .documents.controller import route_document
from .tenants.controller import route_tenant

route_relation = APIRouter(prefix="/relation", tags=[Tags.relation_db])
route_relation.include_router(route_collection)
route_relation.include_router(route_tenant)
route_relation.include_router(route_database)
route_relation.include_router(route_document)
