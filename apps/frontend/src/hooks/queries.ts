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
import { systemAPI, type SystemOverview } from "../api/system";
import { tenantAPI } from "../api/tenant";
import { useI18n } from "../i18n/context";
import { useToast } from "./useToast";
import type { KbCollection, KbDocument } from "../types/knowledge";

export const qk = {
  systemOverview: ["system", "overview"] as const,
  databases: ["knowledge", "databases"] as const,
  collections: (dbId: number) => ["knowledge", "collections", dbId] as const,
  collectionsAll: ["knowledge", "collections", "all"] as const,
  documentsAll: ["knowledge", "documents", "all"] as const,
  documents: (colId: number) => ["knowledge", "documents", colId] as const,
  chunks: (docId: number) => ["knowledge", "chunks", docId] as const,
  tenants: ["access", "tenants"] as const,
  tenantOverview: ["access", "tenant-overview"] as const,
};

/**
 * 概览页的聚合读数。
 *
 * staleTime 给到 60s：这是首屏，但它同时也是最容易被反复切回来的页面
 * （侧栏「概览」→ 对话 → 概览），每次挂载都重跑 6 条聚合查询 + 3 个网络探测不划算。
 */
export function useSystemOverview() {
  return useQuery<SystemOverview>({
    queryKey: qk.systemOverview,
    queryFn: () => systemAPI.overview(),
    staleTime: 60_000,
  });
}

/**
 * 融合面板的唯一数据源。
 * 一次带回：租户 + 每个租户的成员 + 绑定的库与集合数 + 全量授权 + 用户简表（含配额）。
 * 成员/授权/角色的任何变更都整体失效它 —— 见 useAccessMutation。
 */
export function useTenantOverview(enabled = true) {
  return useQuery({
    queryKey: qk.tenantOverview,
    queryFn: () => tenantAPI.getOverview(),
    enabled,
  });
}

/**
 * 只列当前用户可检索的知识库。
 *
 * 以前控制台和检索选择器都读 /database/all —— 那是「所有库」，
 * 于是成员会看到自己读不到的库，选中之后才吃一个 403。
 * /database/mine 一直存在却没人调用；管理员它照样返回全部，所以管理侧不受影响。
 */
export function useDatabases() {
  return useQuery({
    queryKey: qk.databases,
    queryFn: () => databaseAPI.getMine(),
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
  // 这里原先用的是 ["knowledge","collections-all"]，与 useAllCollections 的
  // ["knowledge","collections","all"] 是两份互不相干的缓存：同一个全量集被下载两次，
  // 而且创建集合后只失效后者，级联选择器会拿着旧数据。键统一到一个常量。
  const { data: collections } = useQuery({
    queryKey: qk.collectionsAll,
    queryFn: () => collectionAPI.getAll() as Promise<KbCollection[]>,
  });
  const { data: documents } = useQuery({
    queryKey: qk.documentsAll,
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

/**
 * 删除文档：PG 行 + Milvus 向量 + 落盘文件一起清。
 *
 * 后端刻意先删向量再删关系行，失败时 PG 保持完整，
 * 所以这里失败可以直接重试而不会留下谁也查不到的孤儿向量。
 */
export function useDeleteDocument() {
  const queryClient = useQueryClient();
  return useResourceMutation({
    mutationFn: (documentId: string) => documentAPI.remove(documentId),
    invalidate: () => {
      // 删除会改变链路上每一层的计数，整组失效比逐键推断可靠
      queryClient.invalidateQueries({ queryKey: ["knowledge"] });
    },
    successKey: "admin.vector.docDeleted",
    errorKey: "admin.vector.docDeleteFailed",
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

/** 租户/成员/授权/角色配额的所有变更都收敛在这里：一处失效，避免改完不刷新。 */
function useAccessMutation<TVars>(options: {
  mutationFn: (vars: TVars) => Promise<unknown>;
  successKey?: string;
  errorKey: string;
  /** 除总览之外还要额外失效的键 */
  also?: readonly (readonly string[])[];
}) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const { toast } = useToast();

  return useMutation({
    mutationFn: options.mutationFn,
    onSuccess: () => {
      // 总览把四张表揉成一份响应，所以任何一处成员/授权/角色变化都要整体重来；
      // 单独失效某一张表会让折叠面板上的计数停在旧值。
      queryClient.invalidateQueries({ queryKey: qk.tenantOverview });
      queryClient.invalidateQueries({ queryKey: qk.tenants });
      for (const key of options.also ?? [])
        queryClient.invalidateQueries({ queryKey: key });
      if (options.successKey) toast(t(options.successKey), "success");
    },
    onError: (error: Error) =>
      toast(t(options.errorKey, { msg: error.message }), "error"),
  });
}

export function useCreateTenant() {
  return useAccessMutation({
    mutationFn: (body: { name: string }) => tenantAPI.create(body),
    successKey: "admin.access.tenantCreated",
    errorKey: "admin.access.tenantCreateFailed",
  });
}

export function useDeleteTenant() {
  return useAccessMutation({
    mutationFn: (id: number) => tenantAPI.delete(id),
    successKey: "admin.access.tenantDeleted",
    errorKey: "admin.access.tenantDeleteFailed",
    // 删租户会解绑它名下的知识库，向量侧列表跟着一起走
    also: [qk.databases, qk.collectionsAll],
  });
}

/** 加入 / 移出租户。成员行的两个按钮共用一个 mutation，pending 才能只禁用那一行。 */
export function useToggleMember() {
  return useAccessMutation({
    mutationFn: (vars: { tenantId: number; userId: number; join: boolean }) =>
      vars.join
        ? tenantAPI.addMember(vars.tenantId, vars.userId)
        : tenantAPI.removeMember(vars.tenantId, vars.userId),
    errorKey: "admin.access.memberChangeFailed",
  });
}

/**
 * 设置某个用户对某个知识库的访问级别。
 *
 * 上一版这里写死了 `can_read: true, can_write: true` —— 界面上那颗按钮写的是「授权」，
 * 实际却一次给了读写。现在级别由调用方显式传，撤销则删整行。
 */
export type GrantLevel = "read" | "write" | "manage";

const GRANT_FLAGS: Record<GrantLevel, { can_read: boolean; can_write: boolean; can_manage: boolean }> = {
  read: { can_read: true, can_write: false, can_manage: false },
  write: { can_read: true, can_write: true, can_manage: false },
  manage: { can_read: true, can_write: true, can_manage: true },
};

export function useSetGrant() {
  return useAccessMutation({
    mutationFn: (vars: {
      userId: number;
      dbId: number;
      level: GrantLevel | null;
    }) =>
      vars.level === null
        ? apiClient(`/user/permission/${vars.userId}/databases/${vars.dbId}`, {
            method: "DELETE",
          })
        : apiClient(`/user/permission/${vars.userId}/databases/${vars.dbId}`, {
            method: "POST",
            body: GRANT_FLAGS[vars.level],
          }),
    errorKey: "admin.access.grantFailed",
  });
}

/** 角色与配额：都走 PATCH /user/{id}，后端只允许管理员改这两类字段。 */
export function usePatchUser(userId: number) {
  return useAccessMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiClient(`/user/${userId}`, { method: "PATCH", body }),
    also: [["currentUser"]],
    errorKey: "common.updateFailed",
  });
}
