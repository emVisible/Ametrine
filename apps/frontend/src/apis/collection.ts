import { apiEnum } from "@/enum/apiEnum";
import { BaseResponse } from "./base";
interface CreateCollectionType {
  collection_name: string
  database_name: string
}

interface GetDocumentEntireContentType {
  document_id: string
  collection_name: string
}

interface GetCollectionType {
  database_name: string
}

interface GetCollectionDetailType {
  database_name: string
  collection_name: string
}


export function getCollectionByName(name: string) {
  return fetch(apiEnum.COLLECTION_GET_DETAIL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name })
  })
}

export function getCollections(data: GetCollectionType) {
  return fetch(apiEnum.COLLECTION_GET_ALL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  }).then(res => res.json())
}

export function getCollectionNames(data: GetCollectionType) {
  return fetch(apiEnum.COLLECTION_GET_ALL_NAME, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  })
    .then(response => response.json());
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

export function getCollectionDetail(data: GetCollectionDetailType): Promise<BaseResponse<any>> {
  return fetch(apiEnum.COLLECTION_GET_DETAIL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  }).then(res => res.json())
}

export function getCollectionDetails(data: GetCollectionType): Promise<BaseResponse<any>> {
  return fetch(apiEnum.COLLECTION_GET_ALL_DETAIL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(data)
  }).then(res => res.json())
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