from uuid import UUID

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from src.client import get_relation_db
from src.models import Document, DocumentChunk


class DocumentService:
    def __init__(self, relation_db: AsyncSession):
        self.relation_db = relation_db

    async def document_create_service(
        self, id: UUID, title: str, uploader: str, collection_id: int, meta: dict
    ):
        existing = await self.relation_db.execute(select(Document).where(Document.id == id))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Document already exists")
        document = Document(
            id=id,
            title=title,
            uploader=uploader,
            collection_id=collection_id,
            meta=meta,
        )
        self.relation_db.add(document)
        await self.relation_db.commit()
        await self.relation_db.refresh(document)
        return document

    async def document_get_all_service(self):
        result = await self.relation_db.execute(select(Document))
        return result.scalars().all()

    async def document_get_by_collection_service(self, collection_id: int):
        result = await self.relation_db.execute(
            select(Document).where(Document.collection_id == collection_id)
        )
        return result.scalars().all()

    async def document_get_service(self, document_id: str):
        result = await self.relation_db.execute(
            select(Document).where(Document.id == document_id)
        )
        return result.scalar_one_or_none()

    async def document_describe_service(self, document_id: str):
        result = await self.relation_db.execute(
            select(Document).where(Document.id == document_id)
        )
        document = result.scalar_one_or_none()
        return {
            "title": document.title,
            "uploader": document.uploader,
            "source": document.meta["source"],
            "created_at": document.created_at.isoformat(),
        }

    async def chunk_create_service(self, doc_id: UUID, content: str):
        chunk = DocumentChunk(doc_id=doc_id, content=content)
        self.relation_db.add(chunk)
        await self.relation_db.commit()
        await self.relation_db.refresh(chunk)
        return chunk

    async def chunk_get_by_document_service(
        self, doc_id: UUID, accuracy: bool = False, chunk_id: int = 0
    ):
        if accuracy:
            result = await self.relation_db.execute(
                select(DocumentChunk).where(
                    DocumentChunk.doc_id == doc_id and DocumentChunk.id == chunk_id
                )
            )
            return result.scalars().all()
        else:
            result = await self.relation_db.execute(
                select(DocumentChunk).where(DocumentChunk.doc_id == doc_id)
            )
            return result.scalars().all()


def get_document_service(relation_db: AsyncSession = Depends(get_relation_db)):
    return DocumentService(relation_db=relation_db)
