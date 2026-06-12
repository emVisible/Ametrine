// src/api/rag.ts
import useAuthStore from '../stores/useAuthStore';
import { apiClient } from './client'

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000/api'

// ─── 数据库 (PG) ───
export const databaseAPI = {
  getAll: () => apiClient<any[]>('/relation/database/all'),
  get: (name: string) => apiClient<any>(`/relation/database/get?name=${name}`),
  create: (data: { name: string; description: string }) =>
    apiClient('/relation/database/create', { method: 'POST', body: data }),
}

// ─── 集合 (PG) ───
export const collectionAPI = {
  getAll: () => apiClient<any[]>('/relation/collection/all'),
  getByDatabase: (database_id: number) =>
    apiClient<any[]>(`/relation/collection/all/specific?database_id=${database_id}`),
  get: (collection_name: string) =>
    apiClient<any>(`/relation/collection/get?collection_name=${collection_name}`),
  create: (data: { name: string; database_id: number; description: string }) =>
    apiClient('/relation/collection/create', { method: 'POST', body: data }),
}

// ─── 文档上传 ───
// 上传还是调向量接口，因为需要触发 embedding + 写入 Milvus
// 但 PG 里的 Document 记录是在上传过程中由后端同步创建的
// src/api/rag.ts — 改为调 /relation/document/upload
export const documentAPI = {
  upload: async (file: File, collectionName: string, databaseName: string) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('collection_name', collectionName)
    formData.append('database_name', databaseName)

    const response = await fetch(`${API_BASE}/relation/document/upload`, {
      method: 'POST',
      body: formData,
    })
    if (response.status === 401) {
      useAuthStore.getState().logout()
      window.location.href = '/login'
      throw new Error('登录已过期，请重新登录')
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: '上传失败' }))
      throw new Error(error.detail || `HTTP ${response.status}`)
    }

    return response.json()
  },
  getAll: () => apiClient<any[]>('/relation/document/all'),
  getByCollection: (collection_id: number) =>
    apiClient<any[]>(`/relation/document/collection?collection_id=${collection_id}`),
  getChunks: (doc_id: string) =>
    apiClient<any[]>(`/relation/document/chunk?doc_id=${doc_id}`),
}