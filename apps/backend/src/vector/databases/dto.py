from pydantic import BaseModel


class DatabaseUniversalDto(BaseModel):
    db_name: str
