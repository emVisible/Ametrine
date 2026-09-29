# src/relation/documents/controller.py
from hashlib import sha256
from os import getenv
from pathlib import Path
from time import time
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pymilvus import MilvusClient
from src.client import get_milvus_service
from src.config import xinference_embedding_model_id
from src.llm.service import LLMService, get_llm_service
from src.middleware.tags import ControllerTag
from src.relation.collections.service import CollectionService, get_collection_service
from src.relation.databases.service import DatabaseService, get_database_service
from src.user.auth.service import get_current_user
from src.user.permissions.service import PermissionService, get_permission_service
from src.utils.other import use_vector_database
from src.vector.documents.loader import process_documents
from .service import DocumentService, get_document_service

route_document = APIRouter(prefix="/document", tags=[ControllerTag.relation_db])


# ═══════════════════════════════════════════
# 查询接口（只读 PG）
# ═══════════════════════════════════════════

@route_document.get("/all", summary="获取所有Document")
async def all_documents(service: DocumentService = Depends(get_document_service)):
    return await service.document_get_all_service()


@route_document.get("/collection", summary="获取指定Collection下的Documents")
async def get_specific(
    collection_id: int,
    service: DocumentService = Depends(get_document_service),
):
    return await service.document_get_by_collection_service(collection_id=collection_id)


@route_document.get("/get", summary="获取Document详情")
async def get(
    document_id: str,
    service: DocumentService = Depends(get_document_service),
):
    return await service.document_get_service(document_id=document_id)


@route_document.get("/chunk", summary="获取Document的所有Chunks")
async def get_chunks(
    doc_id: str,
    service: DocumentService = Depends(get_document_service),
):
    return await service.chunk_get_by_document_service(doc_id=doc_id)


# ═══════════════════════════════════════════
# 上传接口（PG → Milvus）
# ═══════════════════════════════════════════

def _collection_fields(milvus: MilvusClient, collection_name: str) -> set[str]:
    collection = milvus.describe_collection(collection_name=collection_name)
    return {field["name"] for field in collection.get("fields", [])}


@route_document.post("/upload", summary="上传文档（PG → Milvus 同步）")
async def upload_document(
    collection_name: str = Form(...),
    database_name: str = Form(default="default"),
    file: UploadFile = File(...),
    # 上传是写操作，原来却完全不认人：任何登录用户（甚至按旧代码是任何人）
    # 都能往任意集合里塞文档，而且 uploader 一律写死成 "admin"，
    # 事后既查不到是谁传的，也没法按人审计。
    # 依赖顺序沿用 /api/llm 那条教训：鉴权与权限要排在会打 Milvus/模型的依赖之前。
    current_user=Depends(get_current_user),
    perm_service: PermissionService = Depends(get_permission_service),
    pg_service: DocumentService = Depends(get_document_service),
    collection_service: CollectionService = Depends(get_collection_service),
    # Milvus + LLM
    milvus: MilvusClient = Depends(get_milvus_service),
    llm_service: LLMService = Depends(get_llm_service),
):
    await perm_service.require_write_database(current_user.id, database_name)
    # ── 1. 保存文件 ──
    doc_dir = getenv("DOC_ADDR")
    Path(doc_dir).mkdir(parents=True, exist_ok=True)
    safe_filename = Path(file.filename or "upload.bin").name
    tmp_path = Path(doc_dir) / f"{uuid4()}-{safe_filename}"
    document_id = uuid4()
    document_created = False

    try:
        contents = await file.read()
        digest = sha256(contents).hexdigest()
        with open(tmp_path, "wb") as f:
            f.write(contents)

        # ── 2. 分块 + 向量化 ──
        # 去重放在分块之前：sha256 早就存进 meta 了，但从来没被查过，
        # 所以重复上传同一个文件会在 Milvus 里堆出两份一样的向量，
        # 检索时同一页内容占掉好几个名额。
        collection = await collection_service.collection_get_service(name=collection_name)
        if not collection:
            raise HTTPException(status_code=404, detail="Collection not found in PG")

        duplicate = await pg_service.document_find_by_digest(
            collection_id=collection.id, sha256=digest
        )
        if duplicate:
            tmp_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=409,
                detail=f"该文件已存在于集合 {collection_name}（{duplicate}）",
            )

        chunks = process_documents(is_multiple=False, file_path=str(tmp_path))
        embeddings = llm_service.embedding_model.embed_documents(
            [chunk.page_content for chunk in chunks]
        )

        # ── 3. 写 PG：Document ──
        await pg_service.document_create_service(
            id=document_id,
            title=safe_filename,
            uploader=current_user.name,
            collection_id=collection.id,
            meta={
                "source": chunks[0].metadata.get("source", ""),
                "stored_path": str(tmp_path),
                "sha256": digest,
                "index_status": "pending",
                "embedding_model": xinference_embedding_model_id,
            },
        )
        document_created = True

        # ── 4. 写 PG：Chunks ──
        created_at = int(time())
        data = []

        for text, embedding in zip(chunks, embeddings):
            chunk = await pg_service.chunk_create_service(
                doc_id=document_id,
                content=text.page_content,
            )
            item = {
                "embedding": [float(x) for x in embedding],
                "doc_id": str(document_id),
                "chunk_id": chunk.id,
            }
            data.append(item)

        # ── 5. 写 Milvus ──
        milvus.use_database(db_name=database_name)

        available_fields = _collection_fields(milvus, collection_name)
        for item in data:
            if "source_type" in available_fields:
                item["source_type"] = "document"
            if "embedding_model" in available_fields:
                item["embedding_model"] = xinference_embedding_model_id
            if "created_at" in available_fields:
                item["created_at"] = created_at

        milvus.insert(collection_name=collection_name, data=data)

        # ── 6. 更新 PG 状态 ──
        await pg_service.document_update_meta_service(
            document_id=document_id,
            meta={"index_status": "indexed", "chunk_count": len(chunks)},
        )

        return {
            "document_id": str(document_id),
            "filename": safe_filename,
            "chunk_count": len(chunks),
            "status": "indexed",
        }

    except Exception as e:
        if document_created:
            await pg_service.document_update_meta_service(
                document_id=document_id,
                meta={"index_status": "failed", "index_error": str(e)},
            )
        raise HTTPException(status_code=500, detail=str(e))

@route_document.delete("/{document_id}", summary="删除文档（PG + Milvus 同步级联）")
async def delete_document(
    document_id: UUID,
    # 知识库原来只能往里加：没有任何删除入口，传错了、传重了、
    # 或者文档里有不该被检索到的内容都清不掉。这是同类产品的基线能力。
    current_user=Depends(get_current_user),
    perm_service: PermissionService = Depends(get_permission_service),
    pg_service: DocumentService = Depends(get_document_service),
    milvus: MilvusClient = Depends(get_milvus_service),
):
    doc = await pg_service.document_locate_service(document_id=document_id)
    await perm_service.require_write_database(current_user.id, doc["database_name"])

    # 先删向量、后删关系行：反过来一旦 Milvus 失败，PG 已经没了，
    # 那批向量就变成谁也查不到的孤儿。这个顺序下 Milvus 失败时 PG 保持完整，可重试。
    milvus.use_database(db_name=doc["database_name"])
    try:
        milvus.delete(
            collection_name=doc["collection_name"],
            filter='doc_id == "%s"' % doc["document_id"],
        )
        milvus.flush(collection_name=doc["collection_name"])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502,
            detail="向量删除失败，文档未删除，可直接重试：%s" % type(exc).__name__,
        )

    return await pg_service.document_delete_service(
        document_id=document_id, stored_path=doc.get("stored_path")
    )
