from pydantic import BaseModel, EmailStr, Field
from fastapi import UploadFile


class CollectionGetDto(BaseModel):
    name: str


class CollectionCreateDto(BaseModel):
    name: str
    tenant_name: str
    database_name: str
    metadata: dict


class DocumentUploadServiceDto(BaseModel):
    collection_name: str
    database: str


class DocumentQueryServiceDto(BaseModel):
    collection_name: str
    filter: str
    output_fields: list[str]
    timeout: float | None
    ids: list | str | int | None
    partition_names: list[str] | None
