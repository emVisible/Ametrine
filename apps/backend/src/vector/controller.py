from fastapi import APIRouter, Depends, File, UploadFile, status
from sqlalchemy.orm import Session
from pymilvus import Collection, CollectionSchema, FieldSchema, DataType, connections
from ..embedding.document_loader import embedding_document
from src.base.database import get_db
from src.base.models import Collection as DBCollection, Database, Tenant
from src.utils import Tags
from src.vector.dto.collection import CollectionCreateDto
from pymilvus import MilvusClient
from langchain_milvus import BM25BuiltInFunction, Milvus


# Milvus 连接设置
route_vector_milvus = APIRouter(prefix="/vector")

client = MilvusClient(host="localhost", port="19530")

@route_vector_milvus.get(
    "/collections",
    summary="[Vector Database] 返回所有collection",
    response_description="返回是否成功",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def get_collections():
    return client.list_collections()


@route_vector_milvus.post(
    "/collection/create",
    summary="[Vector Database] 创建Collection",
    response_description="返回collection",
    status_code=status.HTTP_200_OK,
    tags=[Tags.vector_db],
)
async def create_collection(dto: CollectionCreateDto, db: Session = Depends(get_db)):
    name = dto.name
    tenant_name = dto.tenant_name
    database_name = dto.database_name
    metadata = dto.metadata

    # Milvus集合定义
    schema = client.create_schema(
        auto_id=False,
        enable_dynamic_field=True,
    )
    schema.add_field(field_name="id", datatype=DataType.INT64, is_primary=True)
    schema.add_field(field_name="vector", datatype=DataType.FLOAT_VECTOR, dim=1024)
    schema.add_field(field_name="document", datatype=DataType.VARCHAR, max_length=65535)
    schema.add_field(field_name="source", datatype=DataType.VARCHAR, max_length=500)
    schema.add_field(field_name="metadata", datatype=DataType.JSON)

    # 创建 Milvus 集合
    client.create_collection(collection_name=name, schema=schema)
    return {"status": "success", "message": f"Collection '{name}' created in Milvus."}


# @route_vector_milvus.post(
#     "/upload_single/{collection_name}",
#     summary="[RAG] 根据单一文档转换为矢量",
#     response_description="返回是否成功",
#     status_code=status.HTTP_200_OK,
#     tags=[Tags.vector_db],
# )
# async def upload_single(collection_name: str, file: UploadFile = File(...)):
#     # 从文件中提取文本并生成嵌入
#     content = await file.read()
#     embedding = embedding_document(collection_name, file)  # 使用你的嵌入生成函数

#     # 连接 Milvus 集合
#     collection = Collection(name=collection_name)

#     # 构造数据并插入
#     data = [
#         embedding,
#         [content.decode('utf-8')],
#         [file.filename]
#     ]
#     collection.insert(data)
#     collection.flush()  # 刷新数据到磁盘

#     return {"status": "success", "message": f"Document '{file.filename}' uploaded."}

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
#     "/collections/get_document",
#     summary="[Vector Database] 返回文档详情",
#     response_description="返回是否成功",
#     status_code=status.HTTP_200_OK,
#     tags=[Tags.dev],
# )
# async def document_detail_get(dto: any):
#     collection_name = dto.collection_name
#     document_id = dto.document_id

#     # 查询 Milvus 集合
#     collection = Collection(name=collection_name)
#     results = collection.query(expr=f"id == {document_id}")

#     # 返回查询结果
#     return {"status": "success", "data": results}

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
