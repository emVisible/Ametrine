from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from src.client import get_relation_db

from .collections.service import CollectionService, get_collection_service
from .databases.service import DatabaseService, get_database_service
from .documents.service import DocumentService, get_document_service
from .tenants.service import TenantService, get_tenant_service


class RelationService:
    def __init__(
        self,
        relation_db: AsyncSession,
        collection_service: CollectionService,
        database_service: DatabaseService,
        tenant_service: TenantService,
        document_service: DocumentService,
    ):
        self.collectionService = collection_service
        self.databaseService = database_service
        self.tenantService = tenant_service
        self.documentService = document_service
        self.db = relation_db


def get_relation_service(
    relation_db: AsyncSession = Depends(get_relation_db),
    collection_service=Depends(get_collection_service),
    database_service=Depends(get_database_service),
    document_service=Depends(get_document_service),
    tenant_service=Depends(get_tenant_service),
):
    return RelationService(
        relation_db=relation_db,
        tenant_service=tenant_service,
        collection_service=collection_service,
        database_service=database_service,
        document_service=document_service,
    )
