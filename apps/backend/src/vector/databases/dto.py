from pydantic import BaseModel
from src.vector.naming import MilvusName


class DatabaseUniversalDto(BaseModel):
    db_name: str
class DatabaseCreateDto(BaseModel):
    # 只校验创建：库名会原样作为 Milvus 数据库名，带连字符的根本建不出来，
    # 但已存在的非法名字必须还能查询与删除。
    db_name: MilvusName
    tenant_name: str
    replica_number: int
    description: str
