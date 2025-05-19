from pymilvus import MilvusClient
from fastapi import Depends


class MilvusService:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance = MilvusClient(host="localhost", port="19530")
        return cls._instance


def get_milvus_service():
    return MilvusService()


class VectorService:
    def __init__(self, milvus_service: MilvusService = Depends(get_milvus_service)):
        self.milvus_service = milvus_service
