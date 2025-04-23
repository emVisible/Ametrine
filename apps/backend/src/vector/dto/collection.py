from pydantic import BaseModel, EmailStr, Field
from fastapi import UploadFile


class CollectionCreateDto(BaseModel):
    name: str
    # tenant_name: str
    # database_name: str
    # metadata: dict


class CollectionRenameDto(BaseModel):
    old_name: str
    new_name: str
    target_db: str


class DocumentUploadServiceDto(BaseModel):
    collection_name: str
    database: str


class DocumentQueryServiceDto(BaseModel):
    collection_name: str
    filter_field: str = None
    output_fields: list[str] = []
    timeout: float = None
    ids: list | str | int = None
    partition_names: list[str] = None
