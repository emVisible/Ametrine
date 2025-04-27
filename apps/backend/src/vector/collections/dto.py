from pydantic import BaseModel


class CollectionCreateDto(BaseModel):
    name: str


class CollectionRenameDto(BaseModel):
    old_name: str
    new_name: str
    target_db: str
