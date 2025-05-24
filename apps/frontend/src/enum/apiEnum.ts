export enum apiEnum {
  UPLOAD_IMAGE_URL = '/api/upload_image',
  LOGIN = "/api/auth",
  GET_CURRENT_USER = "/api/current",
  REGISTRY = "/api/user/create",
  LLM_CHAT = "/api/llm/chat",
  RAG_CHAT = "/api/llm/rag",
  GET_REFERENCE_DATA = "/api/llm/references",

  UPLOAD_DOCUMENT = '/api/vector/upload_single',

  DATABASE_GET = "/api/vector/database/get",
  DATABASE_CREATE = "/api/vector/database/create",
  DATABASE_GET_ALL = "/api/vector/database/all",
  DATABASE_GET_Details = "/api/vector/database/details",

  TENANT_CREATE = "/api/relation/tenant/create",
  TENANT_GET = "/api/relation/tenant/get",
  TENANT_GET_ALL = "/api/relation/tenant/all",

  COLLECTION_CREATE = "/api/vector/collection/create",
  COLLECTION_GET_DETAIL = "/api/vector/collection/get",
  COLLECTION_GET_ALL = "/api/vector/collection/all",
  COLLECTION_GET_ALL_NAME = "/api/vector/collection/all",
  COLLECTION_GET_ALL_DETAIL = "/api/vector/collection/details",
  DOCUMENT_GET = "/api/vector/collections/get_document"
}