export enum apiEnum {
  UPLOAD_IMAGE_URL = '/api/upload_image',
  LOGIN = "/api/base/auth",
  REGISTRY = "/api/base/registry",
  GET_CURRENT_USER = "/api/base/current",
  LLM_CHAT = "/api/llm/chat",
  RAG_CHAT = "/api/llm/rag",

  UPLOAD_DOCUMENT = '/api/vector/upload_single',

  DATABASE_GET = "/api/vector/database/get",
  DATABASE_CREATE = "/api/vector/database/create",
  DATABASE_GET_ALL = "/api/vector/databases",

  TENANT_CREATE = "/api/vector/tenant/create",
  TENANT_GET = "/api/vector/tenant/get",
  TENANT_GET_ALL = "/api/vector/tenants",

  COLLECTION_CREATE = "/api/vector/collection/create",
  COLLECTION_GET = "/api/vector/collection/get",
  COLLECTION_GET_ALL = "/api/vector/collections",
  COLLECTION_GET_ALL_NAME = "/api/vector/collections",
  COLLECTION_GET_ALL_DETAIL = "/api/vector/collections/get_detail_all",
  DOCUMENT_GET = "/api/vector/collections/get_document"
}