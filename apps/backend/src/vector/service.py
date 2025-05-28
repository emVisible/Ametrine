from fastapi import Depends
from pymilvus import MilvusClient
from src.client import get_milvus_service

from .collections.service import CollectionService, get_collection_service
from .databases.service import DatabaseService, get_database_service
from .documents.service import DocumentService, get_document_service


class VectorService:
    def __init__(
        self,
        milvus_service: MilvusClient,
        collection_service: CollectionService,
        database_service: DatabaseService,
        document_service: DocumentService,
    ):
        self.milvus_service = milvus_service
        self.collectionService = collection_service
        self.databaseService = database_service
        self.documentService = document_service


def get_vector_service(
    milvus_service: MilvusClient = Depends(get_milvus_service),
    collection_service: CollectionService = Depends(get_collection_service),
    database_service: DatabaseService = Depends(get_database_service),
    document_service: DocumentService = Depends(get_document_service),
):
    return VectorService(
        milvus_service=milvus_service,
        collection_service=collection_service,
        database_service=database_service,
        document_service=document_service,
    )
