from fastapi import APIRouter, Body, Depends
from src.middleware.tags import ControllerTag

from .service import DocumentService, get_document_service

route_document = APIRouter(prefix="/document", tags=[ControllerTag.relation_db])


@route_document.post("/create", summary="创建Document")
async def create(
    id: str = Body(..., embed=True),
    title: str = Body(..., embed=True),
    uploader: str = Body(..., embed=True),
    collection_id: int = Body(..., embed=True),
    meta: dict = Body(..., embed=True),
    service: DocumentService = Depends(get_document_service),
):
    return await service.document_create_service(
        id=id, title=title, uploader=uploader, collection_id=collection_id, meta=meta
    )


@route_document.get("/all", summary="获取所有Document")
async def all_documents(service: DocumentService = Depends(get_document_service)):
    return await service.document_get_all_service()


@route_document.get("/collection", summary="获取指定Collection下的Documents")
async def get_specific(
    collection_id: int,
    service: DocumentService = Depends(get_document_service),
):
    return await service.document_get_by_collection_service(collection_id=collection_id)


@route_document.get("/get", summary="获取Document详情")
async def get(
    document_id: str,
    service: DocumentService = Depends(get_document_service),
):
    return await service.document_get_service(document_id=document_id)


@route_document.post("/chunk/create", summary="创建DocumentChunk")
async def create_chunk(
    doc_id: str = Body(..., embed=True),
    content: str = Body(..., embed=True),
    service: DocumentService = Depends(get_document_service),
):
    return await service.chunk_create_service(
        doc_id=doc_id,
        content=content,
    )


@route_document.get("/chunk", summary="获取Document的所有Chunks")
async def get_chunks(
    doc_id: str,
    service: DocumentService = Depends(get_document_service),
):
    return await service.chunk_get_by_document_service(doc_id=doc_id)
