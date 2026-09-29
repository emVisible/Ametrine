from pathlib import Path
from uuid import UUID

from fastapi import Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import delete, func, tuple_, update
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

    async def chunk_get_many_service(self, pairs, include_disabled: bool = False):
        """一次取回多组 (doc_id, chunk_id) 的分块正文。

        重排原来对每个向量命中各查一次库、再各发一次模型调用，
        而每次只喂一个候选 —— 给单个文档排序没有意义，
        还把 N 次网络往返串在回答路径上。这里收成一次查询 + 一次批量打分。

        include_disabled=False 是「停用分块不参与检索」的唯一执行点：
        向量检索只返回 (doc_id, chunk_id)，正文一律从这里取，
        所以查不到行就等于这条命中不存在 —— 不必给 Milvus 集合加标量字段，
        也就不必重建已有集合。管理界面自己读分块时传 True。
        """
        unique = list({(str(d), c) for d, c in pairs if d is not None})
        if not unique:
            return []
        query = select(DocumentChunk).where(
            tuple_(DocumentChunk.doc_id, DocumentChunk.id).in_(unique)
        )
        if not include_disabled:
            query = query.where(DocumentChunk.enabled.is_(True))
        result = await self.relation_db.execute(query)
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

    async def collection_locate_service(self, collection_id: int):
        """集合 -> (集合名, 所属库名)，一次查询。权限判断与向量写入都要用这两个名字。"""
        result = await self.relation_db.execute(
            select(Collection.name, Database.name)
            .join(Database, Database.id == Collection.database_id)
            .where(Collection.id == collection_id)
        )
        row = result.first()
        if not row:
            raise HTTPException(status_code=404, detail="集合不存在")
        return {"collection_name": row[0], "database_name": row[1]}

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

    async def document_get_all_service(self, database_ids=None):
        """database_ids 不为 None 时只返回这些库里的文档。

        /all 原来一声不响地把全租户所有文档都交出去（只带标题、上传人、meta），
        而知识库控制台对所有登录用户开放 —— 别人的语料清单就是现成的。
        传 None 是管理员路径：调用方自己决定要不要限定范围。
        """
        query = select(Document)
        if database_ids is not None:
            query = query.join(Collection, Collection.id == Document.collection_id).where(
                Collection.database_id.in_(database_ids)
            )
        result = await self.relation_db.execute(query)
        return result.scalars().all()

    async def document_get_by_collection_service(self, collection_id: int, database_ids=None):
        query = select(Document).where(Document.collection_id == collection_id)
        if database_ids is not None:
            query = query.join(Collection, Collection.id == Document.collection_id).where(
                Collection.database_id.in_(database_ids)
            )
        result = await self.relation_db.execute(query)
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

    async def chunk_ownership_service(self, doc_id: UUID, chunk_id: int):
        """确认分块属于这篇文档，顺带拿齐写操作要用的归属信息。

        分块的键是全局自增 id，只按 chunk_id 查会让 A 文档的接口改到 B 文档的分块 ——
        跨集合、跨租户都能命中。所有分块写路由都必须先过这里。
        """
        result = await self.relation_db.execute(
            select(
                DocumentChunk.id,
                DocumentChunk.content,
                DocumentChunk.enabled,
                Document.title,
                Collection.name,
                Database.name,
            )
            .join(Document, Document.id == DocumentChunk.doc_id)
            .join(Collection, Collection.id == Document.collection_id)
            .join(Database, Database.id == Collection.database_id)
            .where(DocumentChunk.doc_id == doc_id, DocumentChunk.id == chunk_id)
        )
        row = result.first()
        if not row:
            raise HTTPException(status_code=404, detail="分块不存在")
        cid, content, enabled, title, collection_name, database_name = row
        return {
            "chunk_id": cid,
            "content": content,
            "enabled": enabled,
            "document_title": title,
            "collection_name": collection_name,
            "database_name": database_name,
        }

    async def chunk_set_enabled_service(self, doc_id: UUID, chunk_id: int, enabled: bool):
        await self.relation_db.execute(
            update(DocumentChunk)
            .where(DocumentChunk.doc_id == doc_id, DocumentChunk.id == chunk_id)
            .values(enabled=enabled)
        )
        await self.relation_db.commit()
        return {"document_id": str(doc_id), "chunk_id": chunk_id, "enabled": enabled}

    async def document_set_enabled_service(self, doc_id: UUID, enabled: bool):
        """整篇文档启用/停用 = 一次批量更新它的分块。

        不给 Document 单独再存一个开关：两处都能表达同一件事时必然出现
        「文档停用但分块启用」这种没人定义过行为的组合。
        分块那一份是唯一事实，界面要的文档级开关只是它的快捷方式。
        """
        result = await self.relation_db.execute(
            update(DocumentChunk)
            .where(DocumentChunk.doc_id == doc_id)
            .values(enabled=enabled)
        )
        await self.relation_db.commit()
        return {"document_id": str(doc_id), "enabled": enabled, "changed": result.rowcount}

    async def chunk_touch_service(self, doc_id: UUID, content: str, chunk_id: int):
        """只改正文；向量的替换由路由层负责（顺序：先向量成功再落 PG）。"""
        await self.relation_db.execute(
            update(DocumentChunk)
            .where(DocumentChunk.doc_id == doc_id, DocumentChunk.id == chunk_id)
            .values(content=content)
        )
        await self.relation_db.commit()

    async def chunk_delete_row_service(self, doc_id: UUID, chunk_id: int):
        await self.relation_db.execute(
            delete(DocumentChunk).where(
                DocumentChunk.doc_id == doc_id, DocumentChunk.id == chunk_id
            )
        )
        await self.relation_db.commit()

    async def chunk_stats_by_collection_service(self, collection_id: int):
        """每个文档 (总块数, 参与检索的块数)，一次查询。

        文档 meta 里那个 chunk_count 是上传时写的一次性数字，删掉一块之后它不会自己变小 ——
        界面上的计数必须现算，不能信那个字段。
        """
        result = await self.relation_db.execute(
            select(
                DocumentChunk.doc_id,
                func.count().label("total"),
                func.count().filter(DocumentChunk.enabled.is_(True)).label("enabled"),
            )
            .join(Document, Document.id == DocumentChunk.doc_id)
            .where(Document.collection_id == collection_id)
            .group_by(DocumentChunk.doc_id)
        )
        return {
            str(row.doc_id): {"total": row.total, "enabled": row.enabled}
            for row in result.all()
        }


def get_document_service(relation_db: AsyncSession = Depends(get_relation_db)):
    return DocumentService(relation_db=relation_db)
