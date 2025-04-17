from pydantic import BaseModel, EmailStr, Field


class CollectionCreateDto(BaseModel):
    name: str
    tenant_name: str
    database_name: str
    metadata: dict
