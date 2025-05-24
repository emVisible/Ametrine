from uuid import UUID

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from src.base.database import get_db
from src.base.models import Document, DocumentChunk


class DocumentService:
    def __init__(self, db: AsyncSession = Depends(get_db)):
        self.db = db

    async def document_create_service(
        self, id: UUID, title: str, uploader: str, collection_id: int, meta: dict
    ):
        existing = await self.db.execute(select(Document).where(Document.id == id))
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Document already exists")
        document = Document(
            id=id,
            title=title,
            uploader=uploader,
            collection_id=collection_id,
            meta=meta,
        )
        self.db.add(document)
        await self.db.commit()
        await self.db.refresh(document)
        return document

    async def document_get_all_service(self):
        result = await self.db.execute(select(Document))
        return result.scalars().all()

    async def document_get_by_collection_service(self, collection_id: int):
        result = await self.db.execute(
            select(Document).where(Document.collection_id == collection_id)
        )
        return result.scalars().all()

    async def document_get_service(self, document_id: str):
        result = await self.db.execute(
            select(Document).where(Document.id == document_id)
        )
        return result.scalar_one_or_none()

    async def document_describe_service(self, document_id: str):
        result = await self.db.execute(
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
        self.db.add(chunk)
        await self.db.commit()
        await self.db.refresh(chunk)
        return chunk

    async def chunk_get_by_document_service(
        self, doc_id: UUID, accuracy: bool = False, chunk_id: int = 0
    ):
        if accuracy:
            result = await self.db.execute(
                select(DocumentChunk).where(
                    DocumentChunk.doc_id == doc_id and DocumentChunk.id == chunk_id
                )
            )
            return result.scalars().all()
        else:
            result = await self.db.execute(
                select(DocumentChunk).where(DocumentChunk.doc_id == doc_id)
            )
            return result.scalars().all()


def get_document(db: AsyncSession = Depends(get_db)) -> DocumentService:
    return DocumentService(db=db)
