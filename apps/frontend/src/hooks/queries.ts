// src/hooks/queries.ts
// 知识库资源的查询与变更集中在此：queryKey、失效范围、失败提示只写一遍。
// 页面此前各自 useQuery + useMutation + invalidateQueries，键名互不一致导致改完不刷新。
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { collectionAPI, databaseAPI, documentAPI } from "../api/rag";
import { apiClient } from "../api/client";
import { tenantAPI } from "../api/tenant";
import { useI18n } from "../i18n/context";
import { useToast } from "./useToast";
import type { UserListResponse } from "../types/user";
import type { KbCollection, KbDocument } from "../types/knowledge";

export const qk = {
  databases: ["knowledge", "databases"] as const,
  collections: (dbId: number) => ["knowledge", "collections", dbId] as const,
  collectionsAll: ["knowledge", "collections", "all"] as const,
  documents: (colId: number) => ["knowledge", "documents", colId] as const,
  chunks: (docId: number) => ["knowledge", "chunks", docId] as const,
  tenants: ["access", "tenants"] as const,
  users: ["access", "users"] as const,
  tenantMembers: (tenantId: number) =>
    ["access", "tenant-members", tenantId] as const,
  userPermissions: (userId: number) =>
    ["access", "user-permissions", userId] as const,
};

/** 成员列表。后端返回 {users,total,offset,limit}，这里只取 users 并保留 total 供诚实展示。 */
export function useUsers() {
  return useQuery({
    queryKey: qk.users,
    queryFn: () => apiClient<UserListResponse>("/user/all"),
  });
}

export function useTenantMembers(tenantId: number | null) {
  return useQuery({
    queryKey: qk.tenantMembers(tenantId!),
    queryFn: () => tenantAPI.getMembers(tenantId!),
    enabled: tenantId != null,
  });
}

export function useUserPermissions(userId: number | null) {
  return useQuery({
    queryKey: qk.userPermissions(userId!),
    queryFn: () =>
      apiClient<{ database_id: number; can_read?: boolean; can_write?: boolean }[]>(
        `/user/permission/${userId}`,
      ),
    enabled: userId != null,
  });
}

export function useDatabases() {
  return useQuery({
    queryKey: qk.databases,
    queryFn: () => databaseAPI.getAll(),
  });
}

export function useCollections(databaseId: number | null) {
  return useQuery({
    queryKey: qk.collections(databaseId!),
    queryFn: () => collectionAPI.getByDatabase(databaseId!),
    enabled: !!databaseId,
  });
}

/**
 * 一次取回全部集合，供检索范围的级联选择器本地按库分组。
 * 不用 useCollections 逐库取：hover 预览要的是零延迟，发请求就会看到转圈与内容跳动。
 */
export function useAllCollections() {
  return useQuery({
    queryKey: qk.collectionsAll,
    queryFn: () => collectionAPI.getAll(),
  });
}

export function useDocuments(collectionId: number | null) {
  return useQuery({
    queryKey: qk.documents(collectionId!),
    queryFn: () => documentAPI.getByCollection(collectionId!),
    enabled: !!collectionId,
  });
}

export function useChunks(documentId: number | null) {
  return useQuery({
    queryKey: qk.chunks(documentId!),
    queryFn: () => documentAPI.getChunks(String(documentId)),
    enabled: !!documentId,
  });
}

export function useTenants() {
  return useQuery({
    queryKey: qk.tenants,
    queryFn: () => tenantAPI.getAll(),
  });
}

/**
 * 后端 database/collection/document 三族都没有 count、分页与过滤端点，
 * 但 collection/all 与 document/all 能一次取回全量。
 * 这里用 3 个请求建出客户端索引来推导各级计数，避免按行取数的 N+1。
 */
export function useKnowledgeIndex() {
  const { data: databases, isLoading, error, refetch } = useDatabases();
  const { data: collections } = useQuery({
    queryKey: ["knowledge", "collections-all"],
    queryFn: () => collectionAPI.getAll() as Promise<KbCollection[]>,
  });
  const { data: documents } = useQuery({
    queryKey: ["knowledge", "documents-all"],
    queryFn: () => documentAPI.getAll() as Promise<KbDocument[]>,
  });

  const collectionsByDb = new Map<number, KbCollection[]>();
  for (const c of collections ?? []) {
    const key = c.database_id ?? 0;
    if (!collectionsByDb.has(key)) collectionsByDb.set(key, []);
    collectionsByDb.get(key)!.push(c);
  }

  const documentsByCollection = new Map<number, KbDocument[]>();
  for (const d of documents ?? []) {
    const key = d.collection_id ?? 0;
    if (!documentsByCollection.has(key)) documentsByCollection.set(key, []);
    documentsByCollection.get(key)!.push(d);
  }

  return {
    databases: databases ?? [],
    collectionsByDb,
    documentsByCollection,
    collectionCount: collections?.length ?? 0,
    documentCount: documents?.length ?? 0,
    isLoading,
    error,
    refetch,
  };
}

/** 变更成功后按范围失效，并统一用 Toast 报告失败。 */
function useResourceMutation<TVars, TRes>(options: {
  mutationFn: (vars: TVars) => Promise<TRes>;
  invalidate: () => void;
  /** 存文案键而不是文案：切语言不需要重建这些 hook */
  successKey?: string;
  errorKey: string;
}) {
  const { t } = useI18n();
  const { toast } = useToast();

  return useMutation({
    mutationFn: options.mutationFn,
    onSuccess: () => {
      options.invalidate();
      if (options.successKey) toast(t(options.successKey), "success");
    },
    onError: (error: Error) =>
      toast(t(options.errorKey, { msg: error.message }), "error"),
  });
}

export function useCreateDatabase() {
  const queryClient = useQueryClient();
  return useResourceMutation({
    mutationFn: (body: {
      name: string;
      description?: string;
      tenant_id?: number | null;
    }) => databaseAPI.create({ ...body, description: body.description ?? "" }),
    invalidate: () => queryClient.invalidateQueries({ queryKey: qk.databases }),
    successKey: "admin.vector.dbCreated",
    errorKey: "admin.vector.dbCreateFailed",
  });
}

export function useCreateCollection(databaseId: number) {
  const queryClient = useQueryClient();
  return useResourceMutation({
    mutationFn: (body: { name: string; description?: string }) =>
      collectionAPI.create({
        name: body.name,
        description: body.description ?? "",
        database_id: databaseId,
      }),
    invalidate: () => {
      queryClient.invalidateQueries({ queryKey: qk.collections(databaseId) });
      queryClient.invalidateQueries({ queryKey: qk.collectionsAll });
      queryClient.invalidateQueries({ queryKey: qk.databases });
    },
    successKey: "admin.vector.colCreated",
    errorKey: "admin.vector.colCreateFailed",
  });
}

export function useUploadDocument(
  handlers: { onUploaded?: () => void } = {},
) {
  const queryClient = useQueryClient();
  return useResourceMutation({
    mutationFn: (body: {
      file: File;
      collectionName: string;
      databaseName: string;
    }) =>
      documentAPI.upload(body.file, body.collectionName, body.databaseName),
    invalidate: () => {
      // 上传会改变链路上每一层的计数，整组失效比逐键推断可靠
      queryClient.invalidateQueries({ queryKey: ["knowledge"] });
      handlers.onUploaded?.();
    },
    successKey: "admin.vector.docUploaded",
    errorKey: "admin.vector.docUploadFailed",
  });
}

export function useCreateTenant() {
  const queryClient = useQueryClient();
  return useResourceMutation({
    mutationFn: (body: { name: string }) => tenantAPI.create(body),
    invalidate: () => queryClient.invalidateQueries({ queryKey: qk.tenants }),
    successKey: "admin.access.tenantCreated",
    errorKey: "admin.access.tenantCreateFailed",
  });
}

export function useDeleteTenant() {
  const queryClient = useQueryClient();
  return useResourceMutation({
    mutationFn: (id: number) => tenantAPI.delete(id),
    invalidate: () => {
      queryClient.invalidateQueries({ queryKey: qk.tenants });
      queryClient.invalidateQueries({ queryKey: qk.databases });
    },
    successKey: "admin.access.tenantDeleted",
    errorKey: "admin.access.tenantDeleteFailed",
  });
}
