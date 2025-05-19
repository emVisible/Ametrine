from pydantic import BaseModel


class CollectionBaseDto(BaseModel):
    database_name: str


class CollectionUniversalDto(CollectionBaseDto):
    collection_name: str

class CollectionCreateDto(CollectionBaseDto):
    collection_name: str
    description: str

class CollectionRenameDto(CollectionBaseDto):
    old_name: str
    new_name: str
