from pydantic import BaseModel


class DocumentUploadServiceDto(BaseModel):
    collection_name: str
    database: str


class DocumentQueryServiceDto(BaseModel):
    database_name: str
    collection_name: str
    data: str
    filter_field: str = None
    output_fields: list[str] = []
    timeout: float = None
    ids: list | str | int = None
    partition_names: list[str] = None
