import { apiEnum } from "@/enum/apiEnum";
interface CreateCollectionType {
  name: string
  tenant_name: string
  database_name: string
  metadata?: Record<string, string>
}

interface GetDocumentEntireContentType {
  document_id: string
  collection_name: string
}

export function getCollectionByName(name: string) {
  return fetch(apiEnum.COLLECTION_GET, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name })
  })
}

export function getCollections() {
  return fetch(apiEnum.COLLECTION_GET_ALL)
}

export function getCollectionNames() {
  return fetch(apiEnum.COLLECTION_GET_ALL_NAME)
}

export function createCollection(data: CreateCollectionType) {
  return fetch(apiEnum.COLLECTION_CREATE, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  })
}

export function getCollectionsDetail() {
  return fetch(apiEnum.COLLECTION_GET_ALL_DETAIL)
}

export function getDocumentEntireContent(data: GetDocumentEntireContentType) {
  return fetch(apiEnum.DOCUMENT_GET, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  })
}