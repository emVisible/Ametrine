from fastapi import APIRouter, Depends, File, UploadFile, status, Form
from sqlalchemy.orm import Session
from src.base.database import get_db
from src.utils import Tags
from src.vector.dto.collection import (
    CollectionCreateDto,
    DocumentQueryServiceDto,
    CollectionGetDto,
    DocumentUploadServiceDto,
)
from .service import (
    collection_get_all_service,
    collection_get_service,
    collection_create_service,
    document_upload_service,
    document_query_service,
    collection_reset_service,
)


# Milvus 连接设置
route_vector_milvus = APIRouter(prefix="/vector")


@route_vector_milvus.get(
    "/collections",
    summary="[Vector Database] 返回所有collection",
    response_description="返回是否成功",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def get_collections():
    return await collection_get_all_service()


@route_vector_milvus.post(
    "/collection/create",
    summary="[Vector Database] 创建Collection",
    response_description="返回collection",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def create_collection(dto: CollectionCreateDto, db: Session = Depends(get_db)):
    return await collection_create_service(dto)


@route_vector_milvus.get(
    "/collection",
    summary="[Vector Database] 获取Collection详细信息",
    response_description="返回collection描述信息",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def get_collection(dto: CollectionGetDto, db: Session = Depends(get_db)):
    return await collection_get_service(dto)


@route_vector_milvus.post(
    "/collection/reset",
    summary="[Vector Database] 重置Collection",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def get_collection():
    return await collection_reset_service()


@route_vector_milvus.post(
    "/upload_single",
    summary="[Vector] 根据单一文档转换为矢量",
    response_description="返回是否成功",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def upload_single(
    collection_name: str = Form(...),
    database: str = Form(default="default"),
    file: UploadFile = File(...),
):
    return await document_upload_service(
        collection_name=collection_name, database=database, file=file
    )


@route_vector_milvus.post(
    "/collections/get_document",
    summary="[Vector Database] 返回文档详情",
    response_description="返回是否成功",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def document_detail_get(dto: DocumentQueryServiceDto):
    result = document_query_service(dto)
    return {"status": "success", "data": result}


# @route_vector.post(
#     "/generate",
#     summary="[RAG] 批量创建矢量库",
#     response_description="返回是否成功",
#     status_code=status.HTTP_200_OK,
#     tags=[Tags.vector_db],
# )
# async def generate():
#     # 假设你的文件夹路径是 "docs"
#     directory = "docs"
#     all_files = os.listdir(directory)
#     embeddings = []
#     texts = []
#     sources = []

#     for file in all_files:
#         with open(os.path.join(directory, file), "r") as f:
#             content = f.read()
#             embedding = generate_embedding(content)
#             embeddings.append(embedding)
#             texts.append(content)
#             sources.append(file)

#     # 将数据插入到 Milvus
#     collection = Collection(name="my_collection")
#     collection.insert([embeddings, texts, sources])
#     collection.flush()  # 刷新数据到磁盘

#     return {"status": "success", "message": "Documents generated and inserted."}


# @route_vector_milvus.post(
#     "/collection/delete",
#     summary="[Vector Database] 删除collection",
#     response_description="返回是否成功",
#     status_code=status.HTTP_200_OK,
#     tags=[Tags.vector_db],
# )
# async def delete_collection(dto: any):
#     collection_name = dto.name

#     # 删除集合
#     collection = Collection(name=collection_name)
#     collection.drop()

#     return {"status": "success", "message": f"Collection '{collection_name}' deleted."}
