from pydantic import BaseModel


class DocumentQueryServiceDto(BaseModel):
    """只列检索真正会用到的参数。

    原来还带着 filter_field / output_fields / timeout / ids / partition_names 五个字段，
    服务层一个都没读 —— 契约上写着能过滤，传了也不起作用，
    而这种「参数存在但被忽略」的接口最难查：调用方以为过滤生效了。
    output_fields 更是写死的 ["doc_id", "chunk_id"]，交给调用方只会让检索结果对不上引用。
    """

    database_name: str
    collection_name: str
    data: str
    limit: int = 10
