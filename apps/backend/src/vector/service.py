from pymilvus import MilvusClient


class MilvusService:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance = MilvusClient(host="localhost", port="19530")
        return cls._instance


def get_milvus_service():
    return MilvusService()
