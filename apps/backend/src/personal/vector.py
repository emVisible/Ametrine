from __future__ import annotations

import anyio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.middleware.logger import config_logger
from src.models import Collection, Database, Document, DocumentChunk
from src.user.permissions.service import accessible_database_ids

TIMEOUT_SECONDS = 10


class _EmbeddingHost:
    def __init__(self, embedding_model):
        self.embedding_model = embedding_model


async def _sources(db: AsyncSession, user_id: int) -> list[tuple[str, str]]:
    readable = await accessible_database_ids(db, user_id)
    if readable is not None and not readable:
        return []
    stmt = (
        select(Database.name, Collection.name)
        .join(Collection, Collection.database_id == Database.id)
        .order_by(Database.name, Collection.name)
    )
    if readable is not None:
        stmt = stmt.where(Database.id.in_(readable))
    return [(row[0], row[1]) for row in (await db.execute(stmt)).all()]


def _passage(chunk: DocumentChunk, document: Document, collection: Collection,
             database: Database, hit: dict) -> dict:
    text = " ".join((chunk.content or "").split())
    return {
        "type": "passage", "id": f"passage:{document.id}:{chunk.id}",
        "document_id": str(document.id), "title": document.title,
        "collection": collection.name, "database": database.name,
        "text": text[:700], "excerpt": text[:200],
        "score": hit.get("relevance_score"), "score_kind": hit.get("score_kind"),
        "sources": hit.get("sources") or [],
    }


async def search(db: AsyncSession, user_id: int, query: str,
                 limit: int = 20) -> dict:
    """Vector search over accessible collections; degradation is explicit.

    Embedding and Milvus are local-first external dependencies. When either is
    absent this returns `degraded=True` with a short reason instead of turning
    personal search into a 500 or silently pretending lexical is vector.
    """
    sources = await _sources(db, user_id)
    if not sources:
        return {"documents": [], "degraded": False, "reason": "no_documents"}
    try:
        from src.client import get_embedding_model, get_milvus_service
        from src.vector.documents.service import DocumentService

        service = DocumentService(
            milvus_service=await get_milvus_service(),
            relation_service=None,
            llm_service=_EmbeddingHost(get_embedding_model()),
        )
        with anyio.fail_after(TIMEOUT_SECONDS):
            hits = await service.documents_query_multi_service(
                data=query, sources=sources, limit=limit)
    except TimeoutError:
        return {"documents": [], "degraded": True, "reason": "timeout"}
    except Exception as exc:  # noqa: BLE001
        config_logger.warning("personal vector search degraded: %s: %s",
                              type(exc).__name__, exc)
        return {"documents": [], "degraded": True,
                "reason": type(exc).__name__}

    ids = [int(hit["chunk_id"]) for hit in hits if hit.get("chunk_id") is not None]
    if not ids:
        return {"documents": [], "degraded": False, "reason": "no_hits"}
    rows = (await db.execute(
        select(DocumentChunk, Document, Collection, Database)
        .join(Document, Document.id == DocumentChunk.doc_id)
        .join(Collection, Collection.id == Document.collection_id)
        .join(Database, Database.id == Collection.database_id)
        .where(DocumentChunk.id.in_(ids), DocumentChunk.enabled.is_(True))
    )).all()
    by_chunk = {chunk.id: (chunk, document, collection, database)
                for chunk, document, collection, database in rows}
    out = []
    for hit in hits:
        found = by_chunk.get(int(hit["chunk_id"])) if hit.get("chunk_id") is not None else None
        if found:
            out.append(_passage(*found, hit))
    return {"documents": out, "degraded": False, "reason": None}
