// src/api/rag.ts
// 知识库资源的 HTTP 边界。返回类型集中在这里，页面层不再到处 `any`。
import useAuthStore from "../stores/useAuthStore";
import { t } from "../i18n";
import { apiClient } from "./client";
import type {
  KbChunk,
  KbCollection,
  KbDatabase,
  KbDocument,
} from "../types/knowledge";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3000/api";

export const databaseAPI = {
  getAll: () => apiClient<KbDatabase[]>("/relation/database/all"),
  getMine: () => apiClient<KbDatabase[]>("/relation/database/mine"),
  get: (name: string) =>
    apiClient<KbDatabase | null>(
      `/relation/database/get?name=${encodeURIComponent(name)}`,
    ),
  create: (data: {
    name: string;
    description?: string;
    tenant_id?: number | null;
  }) => apiClient<KbDatabase>("/relation/database/create", { method: "POST", body: data }),
  delete: (name: string) =>
    apiClient<{ message: string }>(
      `/relation/database/delete?name=${encodeURIComponent(name)}`,
      { method: "DELETE" },
    ),
};

export const collectionAPI = {
  getAll: () => apiClient<KbCollection[]>("/relation/collection/all"),
  getByDatabase: (database_id: number) =>
    apiClient<KbCollection[]>(
      `/relation/collection/all/specific?database_id=${database_id}`,
    ),
  get: (collection_name: string) =>
    apiClient<KbCollection | null>(
      `/relation/collection/get?collection_name=${encodeURIComponent(collection_name)}`,
    ),
  create: (data: {
    name: string;
    database_id: number;
    description?: string;
  }) => apiClient<KbCollection>("/relation/collection/create", { method: "POST", body: data }),
};

export const documentAPI = {
  /**
   * 上传必须是裸 fetch：multipart 不能走 apiClient 的 JSON 序列化。
   * 后端需要同时拿到 database_name 与 collection_name —— 定位一个 Milvus
   * collection 靠的是这两个名字，而不是 id（见 docs/refactor/2026-09-28-backend-contract-and-console.md）。
   */
  upload: async (
    file: File,
    collectionName: string,
    databaseName: string,
  ): Promise<{
    document_id: string;
    filename: string;
    chunk_count: number;
    status: string;
  }> => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("collection_name", collectionName);
    formData.append("database_name", databaseName);

    const token = useAuthStore.getState().token;
    const response = await fetch(`${API_BASE}/relation/document/upload`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: formData,
    });

    if (response.status === 401) {
      useAuthStore.getState().logout();
      window.location.href = "/login";
      throw new Error(t("errors.unauthorized"));
    }
    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ detail: `HTTP ${response.status}` }));
      throw new Error(error.detail || error.message || t("errors.uploadFailed"));
    }
    const result = await response.json();
    return result.data ?? result;
  },
  getAll: () => apiClient<KbDocument[]>("/relation/document/all"),
  getByCollection: (collection_id: number) =>
    apiClient<KbDocument[]>(
      `/relation/document/collection?collection_id=${collection_id}`,
    ),
  get: (document_id: string) =>
    apiClient<KbDocument | null>(
      `/relation/document/get?document_id=${encodeURIComponent(document_id)}`,
    ),
  getChunks: (doc_id: string) =>
    apiClient<KbChunk[]>(`/relation/document/chunk?doc_id=${doc_id}`),
};
