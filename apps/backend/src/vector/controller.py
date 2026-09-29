from fastapi import APIRouter, Depends
from src.user.auth.service import get_current_user
from .databases.controller import route_vector_database
from .collections.controller import route_vector_collection
from .documents.controller import route_vector_document


# 同 relation 面：Milvus 的库/集合清单也是元数据，不该匿名可读
route_vector_milvus = APIRouter(
    prefix="/vector",
    dependencies=[Depends(get_current_user)],
)
route_vector_milvus.include_router(route_vector_database)
route_vector_milvus.include_router(route_vector_collection)
route_vector_milvus.include_router(route_vector_document)
