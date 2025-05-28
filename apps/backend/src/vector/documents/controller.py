from fastapi import APIRouter, Depends, File, Form, UploadFile
from src.middleware.tags import ControllerTag

from .dto import DocumentQueryServiceDto
from .service import DocumentService

route_vector_document = APIRouter(prefix="/document", tags=[ControllerTag.vector_db])


@route_vector_document.post("/search", summary="返回文档详情")
async def document_search(
    dto: DocumentQueryServiceDto, service: DocumentService = Depends(DocumentService)
):
    return await service.document_query_service(dto)


@route_vector_document.post("/upload", summary="根据单一文档转换为矢量")
async def upload_single(
    collection_name: str = Form(...),
    database_name: str = Form(default="default"),
    file: UploadFile = File(...),
    service: DocumentService = Depends(DocumentService),
):
    return await service.document_upload_service(
        collection_name=collection_name, database_name=database_name, file=file
    )
