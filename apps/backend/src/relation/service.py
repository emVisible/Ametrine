from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from src.base.database import get_db

from .collections.service import CollectionService, get_collection
from .databases.service import DatabaseService, get_database
from .documents.service import DocumentService, get_document
from .tenants.service import TenantService, get_tenant


class RelationService:
    def __init__(
        self,
        db: AsyncSession = Depends(get_database),
        collection_service: CollectionService = Depends(get_collection),
        database_service: DatabaseService = Depends(get_database),
        tenant_service: TenantService = Depends(get_tenant),
        document_service: DocumentService = Depends(get_document),
    ):
        self.collectionService = collection_service
        self.databaseService = database_service
        self.tenantService = tenant_service
        self.documentService = document_service
        self.db = db


def get_relation(db: AsyncSession = Depends(get_db)) -> RelationService:
    return RelationService(
        db=db,
        collection_service=get_collection(db),
        database_service=get_database(db),
        tenant_service=get_tenant(db),
        document_service=get_document(db),
    )
