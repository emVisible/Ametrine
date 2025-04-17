from pymilvus import connections
from pymilvus import CollectionSchema, FieldSchema, DataType, Collection
from pymilvus import MilvusClient
from pymilvus import Collection, CollectionSchema, FieldSchema, DataType, connections
# connections.connect(host="localhost", port=19530)

# fields = [
#     FieldSchema(name="id", dtype=DataType.INT64, is_primary=True, auto_id=True),
#     FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=512),
#     FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=65535),
#     FieldSchema(name="source", dtype=DataType.VARCHAR, max_length=512),
# ]

# schema = CollectionSchema(fields=fields, description="My document collection")
# collection = Collection(name="my_collection", schema=schema)



# def create_milvus_collection(collection_name: str, dim: int = 768):
#     # 如果已连接就不会重复连接
#     connections.connect(host="localhost", port=19530)

#     # if collection_name in list_collections():
#     #     print(f"[Milvus] Collection '{collection_name}' already exists.")
#     #     return Collection(name=collection_name)

#     # 定义字段
#     fields = [
#         FieldSchema(name="id", dtype=DataType.INT64, is_primary=True, auto_id=True),
#         FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=dim),
#         FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=65535),
#         FieldSchema(name="source", dtype=DataType.VARCHAR, max_length=500),
#     ]

#     schema = CollectionSchema(fields=fields, description="Collection for document embeddings")

#     # 创建并返回 Collection 实例
#     collection = Collection(name=collection_name, schema=schema)
#     collection.flush()
#     print(f"[Milvus] Collection '{collection_name}' created.")
#     return collection


# def insert_documents(
#     collection_name: str,
#     texts: list[str],
#     embeddings: list[list[float]],
#     sources: list[str]
# ):
#     collection = Collection(name=collection_name)

#     data = [
#         embeddings,  # Must match order of schema: embedding first
#         texts,
#         sources
#     ]

#     collection.insert(data)
#     collection.flush()
#     print(f"[Milvus] Inserted {len(texts)} documents.")

# def search_documents(
#     collection_name: str,
#     query_embedding: list[float],
#     top_k: int = 5,
#     metric_type: str = "L2"
# ):
#     collection = Collection(name=collection_name)

#     search_params = {"metric_type": metric_type, "params": {"nprobe": 10}}
#     results = collection.search(
#         data=[query_embedding],
#         anns_field="embedding",
#         param=search_params,
#         limit=top_k,
#         output_fields=["text", "source"],
#     )

#     return results[0]

# def clear_collection(collection_name: str):
#     collection = Collection(name=collection_name)

#     # 清空集合
#     collection.delete(expr="*")  # 删除所有文档
#     collection.flush()  # 刷新数据
#     print(f"[Milvus] Collection '{collection_name}' has been cleared.")

# def delete_documents(collection_name: str, expr: str):
#     collection = Collection(name=collection_name)

#     # 删除符合条件的文档
#     collection.delete(expr=expr)
#     collection.flush()  # 刷新数据
#     print(f"[Milvus] Deleted documents matching: {expr}")

# def search_by_metadata(collection_name: str, metadata_field: str, metadata_value: str, top_k: int = 5):
#     collection = Collection(name=collection_name)

#     # 构建查询条件：比如 `source` 字段为 'doc1.txt'
#     query_expr = f"{metadata_field} == '{metadata_value}'"

#     search_params = {"metric_type": "L2", "params": {"nprobe": 10}}
#     results = collection.search(
#         data=[[0.1]*768],  # 用一个虚拟的查询向量作为占位
#         anns_field="embedding",
#         param=search_params,
#         limit=top_k,
#         expr=query_expr,  # 查询条件
#         output_fields=["text", "source"]
#     )

#     return results[0]


