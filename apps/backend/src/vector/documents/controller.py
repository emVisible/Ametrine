from fastapi import APIRouter, Depends, File, UploadFile, status, Form
from src.logger import Tags
from .dto import DocumentQueryServiceDto
from .service import DocumentService


route_vector_document = APIRouter(prefix="/document")


@route_vector_document.post(
    "/search",
    summary="返回文档详情",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def document_search(
    dto: DocumentQueryServiceDto, service: DocumentService = Depends(DocumentService)
):
    result = await service.document_query_service(dto)
    return {"status": "success", "data": result}


@route_vector_document.post(
    "/upload",
    summary="根据单一文档转换为矢量",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def upload_single(
    collection_name: str = Form(...),
    database_name: str = Form(default="default"),
    file: UploadFile = File(...),
    service: DocumentService = Depends(DocumentService),
):
    return await service.document_upload_service(
        collection_name=collection_name, database_name=database_name, file=file
    )
