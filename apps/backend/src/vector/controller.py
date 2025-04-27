from fastapi import APIRouter
from .databases.controller import route_vector_database
from .collections.controller import route_vector_collection
from .documents.controller import route_vector_document


route_vector_milvus = APIRouter(prefix="/vector")
route_vector_milvus.include_router(route_vector_database)
route_vector_milvus.include_router(route_vector_collection)
route_vector_milvus.include_router(route_vector_document)
