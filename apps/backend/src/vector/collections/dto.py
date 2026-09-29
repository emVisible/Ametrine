from pydantic import BaseModel
from src.vector.naming import MilvusName


class CollectionBaseDto(BaseModel):
    database_name: str


class CollectionUniversalDto(CollectionBaseDto):
    collection_name: str


class CollectionCreateDto(CollectionBaseDto):
    # 只校验创建/改名的新名字：Universal 那份被 get/delete 复用，
    # 一起卡住的话已经建错的集合就再也删不掉了。
    collection_name: MilvusName
    description: str


class CollectionRenameDto(CollectionBaseDto):
    old_name: str
    new_name: MilvusName
