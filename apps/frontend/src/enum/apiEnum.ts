export enum apiEnum {
  UPLOAD_IMAGE_URL = '/api/upload_image',
  LOGIN = "/api/auth",
  GET_CURRENT_USER = "/api/current",
  REGISTRY = "/api/user/registry",
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
  COLLECTION_GET_ALL = "/api/vector/collection/all",
  COLLECTION_GET_ALL_NAME = "/api/vector/collection/all",
  COLLECTION_GET_ALL_DETAIL = "/api/vector/collections/all_detail",
  DOCUMENT_GET = "/api/vector/collections/get_document"
}