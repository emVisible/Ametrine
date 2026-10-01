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
import { conversationAPI, type UnresolvedRow } from "../api/converstion";
import { systemAPI, type SystemOverview } from "../api/system";
import {
  inferenceAPI,
  type InferenceOverview,
  type InferenceRole,
  type LaunchBody,
  type LaunchProgress,
} from "../api/inference";
import {
  isTerminalProgress,
  movingLaunches,
} from "../utils/inferenceFormat";
import { tenantAPI } from "../api/tenant";
import { useI18n } from "../i18n/context";
import type { MsgKey } from "../i18n";
import { useToast } from "./useToast";
import type { KbCollection, KbDocument } from "../types/knowledge";

export const qk = {
  systemOverview: ["system", "overview"] as const,
  databases: ["knowledge", "databases"] as const,
  collections: (dbId: number) => ["knowledge", "collections", dbId] as const,
  collectionsAll: ["knowledge", "collections", "all"] as const,
  documentsAll: ["knowledge", "documents", "all"] as const,
  documents: (colId: number) => ["knowledge", "documents", colId] as const,
  chunks: (docId: number | string) => ["knowledge", "chunks", docId] as const,
  chunkStats: (colId: number) => ["knowledge", "chunk-stats", colId] as const,
  tenants: ["access", "tenants"] as const,
  tenantOverview: ["access", "tenant-overview"] as const,
  unresolved: ["conversation", "unresolved"] as const,
  inferenceOverview: ["inference", "overview"] as const,
  // 前缀键：一次加载/卸载会让**所有型号**的目录缓存变旧（权重从「要下载」变成「已在盘上」），
  // 而 staleTime 是 5/10 分钟 —— 没有这两个前缀，界面会在几分钟里对新卸下的模型说「需下载」。
  inferenceCatalogAll: ["inference", "catalog"] as const,
  inferenceRegistrationsAll: ["inference", "registrations"] as const,
  inferenceCatalog: (type: string, name: string) =>
    ["inference", "catalog", type, name] as const,
  inferenceRegistrations: (type: string) =>
    ["inference", "registrations", type] as const,
  launchProgress: (uid: string) => ["inference", "progress", uid] as const,
};

/** 管理台的「未解决 / 差评」队列。它是工单列表，不是仪表盘，所以不做长缓存。 */
export function useUnresolved() {
  return useQuery<UnresolvedRow[]>({
    queryKey: qk.unresolved,
    queryFn: () => conversationAPI.getUnresolved(),
    staleTime: 15_000,
  });
}

/** 反馈只改一行，且改完队列就该重排（差评消失或出现）。 */
export function useSetMessageFeedback() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useI18n();
  return useMutation({
    mutationFn: (args: { messageId: string; verdict: "up" | "down"; note?: string }) =>
      conversationAPI.setFeedback(args.messageId, args.verdict, args.note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.unresolved });
      toast(t("queue.feedbackSaved"), "success");
    },
    onError: (error: Error) =>
      toast(t("queue.feedbackFailed", { msg: error.message }), "error"),
  });
}

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

export function useChunks(documentId: number | string | null) {
  return useQuery({
    queryKey: qk.chunks(documentId!),
    queryFn: () => documentAPI.getChunks(String(documentId)),
    enabled: !!documentId,
  });
}

/** 集合内每个文档的 (总块数, 参与检索的块数)，现算。 */
export function useChunkStats(collectionId: number | null) {
  return useQuery({
    queryKey: qk.chunkStats(collectionId!),
    queryFn: () => documentAPI.chunkStats(collectionId!),
    enabled: !!collectionId,
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
  successKey?: MsgKey;
  errorKey: MsgKey;
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

/**
 * 分块级操作的共同失效范围：动一块会同时改变
 * 该文档的分块列表、所在集合的计数、以及整链的文档数，所以整组失效。
 */
function useChunkMutation<TVars>(options: {
  mutationFn: (vars: TVars) => Promise<unknown>;
  successKey: MsgKey;
  errorKey: MsgKey;
}) {
  const queryClient = useQueryClient();
  return useResourceMutation({
    ...options,
    invalidate: () => queryClient.invalidateQueries({ queryKey: ["knowledge"] }),
  });
}

export function useSetChunkEnabled() {
  return useChunkMutation({
    mutationFn: (vars: {
      docId: string;
      chunkId: number;
      enabled: boolean;
    }) => documentAPI.setChunkEnabled(vars.docId, vars.chunkId, vars.enabled),
    successKey: "admin.vector.chunkToggled",
    errorKey: "admin.vector.chunkToggleFailed",
  });
}

export function useSetDocumentEnabled() {
  return useChunkMutation({
    mutationFn: (vars: { docId: string; enabled: boolean }) =>
      documentAPI.setDocumentEnabled(vars.docId, vars.enabled),
    successKey: "admin.vector.docToggled",
    errorKey: "admin.vector.chunkToggleFailed",
  });
}

export function useUpdateChunk() {
  return useChunkMutation({
    mutationFn: (vars: {
      docId: string;
      chunkId: number;
      content: string;
    }) => documentAPI.updateChunk(vars.docId, vars.chunkId, vars.content),
    successKey: "admin.vector.chunkUpdated",
    errorKey: "admin.vector.chunkUpdateFailed",
  });
}

export function useDeleteChunk() {
  return useChunkMutation({
    mutationFn: (vars: { docId: string; chunkId: number }) =>
      documentAPI.deleteChunk(vars.docId, vars.chunkId),
    successKey: "admin.vector.chunkDeleted",
    errorKey: "admin.vector.chunkDeleteFailed",
  });
}

/** 租户/成员/授权/角色配额的所有变更都收敛在这里：一处失效，避免改完不刷新。 */
function useAccessMutation<TVars>(options: {
  mutationFn: (vars: TVars) => Promise<unknown>;
  successKey?: MsgKey;
  errorKey: MsgKey;
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

/* ───────────────────────── 推理管理（/admin/inference） ───────────────────────── */

/**
 * 推理面板总览。
 *
 * `launchedUids` 是页面自己记的「我提交过加载」的 uid 列表 —— 为什么要把这个状态交给调用方：
 * 服务器在模型**加载完成之前不会把它列进 /v1/models**（实测约 54 秒后才出现），
 * 所以「还有哪些没落定」只有发起方知道自己提交过什么。
 * 但「落定了没有」是服务器说了算，所以在 `refetchInterval` 的函数形态里就着最新读数算：
 * 页面不必把结论复制进 state（那需要一个 effect 纠偏），也没有纠偏前那一帧的旧结论。
 * 没有在途加载时完全不轮询 —— 这页不是仪表盘，安静待着比每两秒打一次上游好。
 */
export function useInferenceOverview(launchedUids: string[]) {
  return useQuery<InferenceOverview>({
    queryKey: qk.inferenceOverview,
    queryFn: () => inferenceAPI.overview(),
    staleTime: 4_000,
    refetchInterval: (q) =>
      movingLaunches(launchedUids, q.state.data).length ? 2_500 : false,
  });
}

/**
 * 单个模型的加载进度。终态就停。
 *
 * 判据来自 `isTerminalProgress`：未知 stage 一律继续轮。
 * 早停一次，界面就会永远停在一个假的「还在加载」上。
 */
export function useLaunchProgress(uid: string | null, enabled: boolean) {
  return useQuery<LaunchProgress>({
    queryKey: qk.launchProgress(uid ?? "-"),
    queryFn: () => inferenceAPI.progress(uid as string),
    enabled: enabled && !!uid,
    refetchInterval: (q) =>
      isTerminalProgress(q.state.data) ? false : 2_000,
  });
}

/** 目录：某个型号能用哪些引擎、有哪些版本（含维度）。按需查，不预取。 */
export function useInferenceCatalog(modelType: string, modelName: string) {
  const trimmed = modelName.trim();
  return useQuery({
    queryKey: qk.inferenceCatalog(modelType, trimmed),
    queryFn: () => inferenceAPI.catalog(modelType, trimmed),
    enabled: trimmed.length >= 2,
    staleTime: 300_000,
  });
}

/**
 * 目录的第一层：这个类型下服务器认识哪些型号。
 *
 * 换类型才重新取一次（一次 46–166 条名字，很轻），所以缓存给到 10 分钟。
 * 这条存在的理由是「界面上要能挑」：以前必须先知道型号名再搜索，
 * 而空态写的是「在下方目录里选一个加载」—— 没有清单可选，那句话就是假话。
 */
export function useInferenceRegistrations(modelType: string) {
  return useQuery({
    queryKey: qk.inferenceRegistrations(modelType),
    queryFn: () => inferenceAPI.registrations(modelType),
    staleTime: 600_000,
  });
}

/** 推理面的变更共同点：成功后总览与概览都要重取（概览里那格就绪度读同一批事实）。 */
function useInferenceMutation<TVars>(options: {
  mutationFn: (vars: TVars) => Promise<unknown>;
  successKey?: MsgKey;
  errorKey: MsgKey;
}) {
  const queryClient = useQueryClient();
  const { t } = useI18n();
  const { toast } = useToast();
  return useMutation({
    mutationFn: options.mutationFn,
    onSuccess: (data: unknown) => {
      queryClient.invalidateQueries({ queryKey: qk.inferenceOverview });
      queryClient.invalidateQueries({ queryKey: qk.systemOverview });
      // 加载/卸载会改变「权重在不在盘上」和「本机能不能跑起来」这两批事实，
      // 它们各自有 5/10 分钟的 staleTime —— 不在这儿失效，目录就会在几分钟里对新卸下的
      // 模型继续说「权重已在盘上」（反之亦然）。按前缀一次清掉，不靠调用点记得枚举型号。
      queryClient.invalidateQueries({ queryKey: qk.inferenceCatalogAll });
      queryClient.invalidateQueries({ queryKey: qk.inferenceRegistrationsAll });
      if (options.successKey) toast(t(options.successKey), "success");
      // 后端把「其实失败了」写在 message 里（例如卸载时服务器报错但模型确实没了）
      const note = (data as { note?: string } | undefined)?.note;
      if (note) toast(note, "success");
    },
    onError: (error: Error) =>
      toast(t(options.errorKey, { msg: error.message }), "error"),
  });
}

export function useLaunchModel() {
  // 这里原来会在提交瞬间 `setQueryData(progress, {progress: 0, stage: "pending"})`，
  // 好让界面立刻有东西显示。但那是一个**我们自己编出来的读数**：服务器还没答话，
  // 页面已经在说「0% · pending」。在途那一行本来就由提交记录驱动（一定会出现），
  // 所以伪造的数据没有换来任何东西，只换来一条可能不是真的百分比。
  return useInferenceMutation({
    mutationFn: (body: LaunchBody) => inferenceAPI.launch(body),
    successKey: "admin.inference.launched",
    errorKey: "admin.inference.launchFailed",
  });
}

export function useTerminateModel() {
  return useInferenceMutation({
    mutationFn: (uid: string) => inferenceAPI.terminate(uid),
    successKey: "admin.inference.terminated",
    errorKey: "admin.inference.terminateFailed",
  });
}

export function useBindModel() {
  return useInferenceMutation({
    mutationFn: (args: { role: InferenceRole; uid: string; name: string }) =>
      inferenceAPI.bind(args.role, args.uid, args.name),
    successKey: "admin.inference.bound",
    // 换 embedding 被拦时，后端给的是成句的解释（维度、影响面、该怎么办）—— 原样透出
    errorKey: "admin.inference.bindFailed",
  });
}

export function useSetAutostart() {
  return useInferenceMutation({
    mutationFn: (args: { uid: string; enabled: boolean }) =>
      inferenceAPI.setAutostart(args.uid, args.enabled),
    errorKey: "admin.inference.autostartFailed",
  });
}

export function useInferenceRelogin() {
  // TVars = void：这条不需要参数，写成默认推断会变成 unknown，
  // 于是 `mutate()` 报「Expected 1-2 arguments, but got 0」。
  return useInferenceMutation<void>({
    mutationFn: () => inferenceAPI.relogin(),
    successKey: "admin.inference.relogged",
    errorKey: "admin.inference.reloginFailed",
  });
}

/**
 * 推理活性探测。刻意**不**走 `useInferenceMutation`：那条会清掉总览/目录/注册表的查询缓存，
 * 而探测本身一个状态都不改 —— 按一次就重取十几条目录，界面变成「我点了什么来着」的转圈。
 * 结果由调用方按数据渲染，失败也在这里原样透出（后端永远回 200，所以走不通的那些角色
 * 是 `probes[i].ok === false`，不是异常）。
 */
export function useInferenceLiveness() {
  const { t } = useI18n();
  const { toast } = useToast();
  return useMutation({
    mutationFn: () => inferenceAPI.liveness(),
    onError: (error: Error) =>
      toast(t("admin.inference.probeFailed", { msg: error.message }), "error"),
  });
}
