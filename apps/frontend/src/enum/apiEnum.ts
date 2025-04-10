export enum apiEnum {
  UPLOAD_IMAGE_URL = '/api/upload_image',
  LOGIN = "/api/base/auth",
  REGISTRY = "/api/base/registry",
  GET_CURRENT_USER = "/api/base/current",
  LLM_CHAT = "/api/llm/chat",
  RAG_CHAT = "/api/rag/chat",

  UPLOAD_DOCUMENT = '/api/vector_store/upload_single',

  DATABASE_GET = "/api/vector_store/database/get",
  DATABASE_CREATE = "/api/vector_store/database/create",
  DATABASE_GET_ALL = "/api/vector_store/databases",

  TENANT_CREATE = "/api/vector_store/tenant/create",
  TENANT_GET = "/api/vector_store/tenant/get",
  TENANT_GET_ALL = "/api/vector_store/tenants",

  COLLECTION_CREATE = "/api/vector_store/collection/create",
  COLLECTION_GET = "/api/vector_store/collection/get",
  COLLECTION_GET_ALL = "/api/vector_store/collections",
  COLLECTION_GET_ALL_NAME = "/api/vector_store/collection/names",
  COLLECTION_GET_ALL_DETAIL = "/api/vector_store/collections/get_detail_all",
  DOCUMENT_GET = "/api/vector_store/collections/get_document"
}