export enum apiEnum {
  UPLOAD_IMAGE_URL = '/api/upload_image',
  LOGIN = "/api/auth",
  GET_CURRENT_USER = "/api/current",
  REGISTRY = "/api/user/create",
  LLM_CHAT = "/api/llm/chat",
  RAG_CHAT = "/api/llm/rag",
  AGENT_COMMUNICATION = "/api/agent/chat",
  GET_REFERENCE_DATA = "/api/llm/references",

  UPLOAD_DOCUMENT = '/api/vector/document/upload',

  DATABASE_GET = "/api/relation/database/get",
  DATABASE_CREATE = "/api/relation/database/create",
  DATABASE_GET_ALL = "/api/relation/database/all",
  DATABASE_GET_Details = "/api/relation/database/details",

  TENANT_CREATE = "/api/relation/tenant/create",
  TENANT_GET = "/api/relation/tenant/get",
  TENANT_GET_ALL = "/api/relation/tenant/all",

  COLLECTION_CREATE = "/api/relation/collection/create",
  COLLECTION_GET_DETAIL = "/api/relation/collection/get",
  COLLECTION_GET_ALL = "/api/relation/collection/all",
  COLLECTION_GET_ALL_NAME = "/api/relation/collection/all",
  COLLECTION_GET_ALL_DETAIL = "/api/relation/collection/details",
  DOCUMENT_GET = "/api/vector/collections/get_document"
}
