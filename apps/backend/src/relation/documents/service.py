from pathlib import Path
from uuid import UUID

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import tuple_
from sqlalchemy.future import select
from src.client import get_relation_db
from src.models import Collection, Database, Document, DocumentChunk


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

    async def chunk_get_many_service(self, pairs):
        """一次取回多组 (doc_id, chunk_id) 的分块正文。

        重排原来对每个向量命中各查一次库、再各发一次模型调用，
        而每次只喂一个候选 —— 给单个文档排序没有意义，
        还把 N 次网络往返串在回答路径上。这里收成一次查询 + 一次批量打分。
        """
        unique = list({(str(d), c) for d, c in pairs if d is not None})
        if not unique:
            return []
        result = await self.relation_db.execute(
            select(DocumentChunk).where(
                tuple_(DocumentChunk.doc_id, DocumentChunk.id).in_(unique)
            )
        )
        return result.scalars().all()

    async def document_find_by_digest(self, collection_id: int, sha256: str):
        """同一集合里内容完全相同的文档标题，没有则 None。

        sha256 从第一天起就写进 meta，但从来没被查过 —— 于是重复上传同一个文件
        会在 Milvus 里堆出两份一样的向量，检索时同一页内容连占好几个名额。
        """
        result = await self.relation_db.execute(
            select(Document.title)
            .where(
                Document.collection_id == collection_id,
                Document.meta["sha256"].astext == sha256,
            )
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def document_locate_service(self, document_id: UUID):
        """一次拿齐删除所需的归属信息：文档 -> 集合 -> 数据库 + 落盘路径。

        原来要拿这些得三次查询，而删除路径上多一次查询就多一个失败点。
        """
        result = await self.relation_db.execute(
            select(
                Document.id,
                Document.title,
                Document.meta,
                Collection.name,
                Database.name,
            )
            .join(Collection, Collection.id == Document.collection_id)
            .join(Database, Database.id == Collection.database_id)
            .where(Document.id == document_id)
        )
        row = result.first()
        if not row:
            raise HTTPException(status_code=404, detail="文档不存在")
        doc_id, title, meta, collection_name, database_name = row
        return {
            "document_id": str(doc_id),
            "title": title,
            "collection_name": collection_name,
            "database_name": database_name,
            "stored_path": (meta or {}).get("stored_path"),
        }

    async def document_delete_service(self, document_id: UUID, stored_path=None):
        """删 PG 文档（分块由 ORM 级联带走）并清掉落盘文件。"""
        result = await self.relation_db.execute(
            select(Document).where(Document.id == document_id)
        )
        doc = result.scalar_one_or_none()
        if not doc:
            raise HTTPException(status_code=404, detail="文档不存在")
        doc_title = doc.title
        await self.relation_db.delete(doc)
        await self.relation_db.commit()
        removed_file = False
        if stored_path:
            path = Path(stored_path)
            if path.is_file():
                path.unlink()
                removed_file = True
        return {
            "message": f"文档 {doc_title} 已删除",
            "removed_file": removed_file,
        }

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

    async def document_update_meta_service(self, document_id: UUID, meta: dict):
        result = await self.relation_db.execute(
            select(Document).where(Document.id == document_id)
        )
        document = result.scalar_one_or_none()
        if not document:
            raise HTTPException(status_code=404, detail="Document not found")
        document.meta = {**(document.meta or {}), **meta}
        await self.relation_db.commit()
        await self.relation_db.refresh(document)
        return document

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
                    DocumentChunk.doc_id == doc_id,
                    DocumentChunk.id == chunk_id,
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
