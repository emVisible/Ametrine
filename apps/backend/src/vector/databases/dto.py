from pydantic import BaseModel


class DatabaseUniversalDto(BaseModel):
    db_name: str
class DatabaseCreateDto(BaseModel):
    db_name: str
    tenant_name: str
    replica_number: int
