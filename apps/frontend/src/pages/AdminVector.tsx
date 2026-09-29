// src/pages/AdminVector.tsx
// 知识库控制台：知识库列表 → 就地展开集合 → 点集合才进文档与分块页。
// 两级在 URL 上仍然是 /admin/vector/:dbId(/:colId)，所以深链、刷新、后退都不变。
// 历史：最早是三个平铺 tab 各自重复「选库→选集合→列卡片」且上传后整页 reload；
// 上一版改成三级整页下钻，但「集合」独占一页只会让两个集合名占满屏幕，
// 也没法在两个知识库之间对着比较 —— 现在收进折叠带。
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useI18n } from "../i18n/context";
import { intlLocale } from "../i18n";
import { useIsAdmin } from "../hooks/useAuth";
import { useConfirm } from "../hooks/useConfirm";
import { resolveDrilldown } from "../utils/drilldown";
import { paginate } from "../utils/pagination";
import {
  Breadcrumbs,
  DataTable,
  Disclosure,
  EmptyState,
  Loading,
  Modal,
  PageHeader,
  Pagination,
  Panel,
  SearchInput,
  Select,
  StatusBadge,
  TextArea,
  TextInput,
  Toggle,
  type Column,
} from "../components/ui";
import {
  useChunkStats,
  useCreateCollection,
  useCreateDatabase,
  useDeleteChunk,
  useDeleteDocument,
  useKnowledgeIndex,
  useSetChunkEnabled,
  useSetDocumentEnabled,
  useTenants,
  useUpdateChunk,
  useUploadDocument,
} from "../hooks/queries";
import { useChunks } from "../hooks/queries";
import { useToast } from "../hooks/useToast";
import { documentAPI, type RecallResult } from "../api/rag";
import type {
  KbChunk,
  KbCollection,
  KbDatabase,
  KbDocument,
} from "../types/knowledge";
import {
  BookIcon,
  ChevronRightIcon,
  DatabaseIcon,
  FileIcon,
  LayersIcon,
  LibraryIcon,
  PlusIcon,
  UploadIcon,
} from "../components/icons";

function IndexStatusBadge({ doc }: { doc: KbDocument }) {
  const { t } = useI18n();
  const status = doc.meta?.index_status;
  // 后端只在成功时写 chunk_count、失败时写 index_error，缺失必须容错
  if (status === "indexed")
    return (
      <StatusBadge
        tone="success"
        dot
        title={t("admin.vector.chunksN", { n: doc.meta?.chunk_count ?? 0 })}
      >
        {t("admin.vector.indexed")}
      </StatusBadge>
    );
  if (status === "failed")
    return (
      <StatusBadge
        tone="danger"
        dot
        title={doc.meta?.index_error || t("admin.vector.indexFailed")}
      >
        {t("admin.vector.indexFailed")}
      </StatusBadge>
    );
  if (status === "pending")
    return (
      <StatusBadge tone="warning" dot>
        {t("admin.vector.pending")}
      </StatusBadge>
    );
  return <StatusBadge tone="neutral">{t("admin.vector.noIndexInfo")}</StatusBadge>;
}

/* ─────────────── 第一级 + 第二级：知识库列表，集合就地展开 ─────────────── */

/**
 * 一个知识库 = 一行折叠。
 *
 * 集合原本是独立的一整页：点开一个库就把知识库列表换掉，只看两三个集合名
 * 不值得占一屏，也没法在两个库之间对着一眼比较。现在展开带内直接列集合，
 * 地址栏仍写 /admin/vector/:dbId —— 分享与刷新回到同一个展开态，
 * 只有点到具体集合才进第三级（分块与索引）。
 */
function DatabaseRow({
  database,
  collections,
  documentsByCollection,
  expanded,
  onOpen,
  onClose,
}: {
  database: KbDatabase;
  collections: KbCollection[];
  documentsByCollection: Map<number, KbDocument[]>;
  expanded: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  // 后端把建集合收紧成管理员专属后，普通成员进来是只读的：
  // 继续显示按钮只会换来一个 403。
  const isAdmin = useIsAdmin();
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({ name: "", description: "" });
  const create = useCreateCollection(database.id);

  // 展开带里的统计用全量集合算，不受下面的过滤影响：
  // 搜索时头部如果跟着变成「2 个集合」，读数就会在输入过程中乱跳。
  const stats = useMemo(() => {
    let docs = 0;
    let failed = 0;
    let pending = 0;
    for (const c of collections) {
      const list = documentsByCollection.get(c.id) ?? [];
      docs += list.length;
      for (const d of list) {
        if (d.meta?.index_status === "failed") failed += 1;
        else if (d.meta?.index_status === "pending") pending += 1;
      }
    }
    return { docs, failed, pending };
  }, [collections, documentsByCollection]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...collections]
      .filter(
        (c) =>
          !needle ||
          c.name.toLowerCase().includes(needle) ||
          (c.description ?? "").toLowerCase().includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name, intlLocale()));
  }, [collections, query]);

  return (
    <Disclosure
      open={expanded}
      onToggle={expanded ? onClose : onOpen}
      title={
        <span className="flex min-w-0 items-center gap-2.5">
          <DatabaseIcon className="h-4 w-4 shrink-0 text-ink-subtle" />
          <span className="min-w-0">
            <span className="flex items-center gap-2 truncate font-medium text-ink">
              {database.name}
              {/* 整列都是「可用」时徽章没有信息量，只标异常 */}
              {database.is_active === false && (
                <StatusBadge tone="neutral">{t("common.inactive")}</StatusBadge>
              )}
            </span>
            <span className="block truncate text-[11px] text-ink-subtle">
              {database.description || t("ui.noDescription")}
            </span>
          </span>
        </span>
      }
      meta={
        <>
          {database.tenant_name ? (
            <span className="text-[11px] text-ink-muted">
              {database.tenant_name}
            </span>
          ) : (
            <span className="text-[11px] text-ink-subtle">
              {t("admin.vector.unbound")}
            </span>
          )}
          <span className="tnum text-[11px] text-ink-subtle">
            {t("admin.vector.rowStats", {
              cols: collections.length,
              docs: stats.docs,
            })}
          </span>
          {/* 正常态不占注意力，只有失败和待处理值得在收起时就看见 */}
          {stats.failed > 0 && (
            <StatusBadge tone="danger">
              {t("admin.vector.failedN", { n: stats.failed })}
            </StatusBadge>
          )}
          {stats.pending > 0 && (
            <StatusBadge tone="warning">
              {t("admin.vector.pendingN", { n: stats.pending })}
            </StatusBadge>
          )}
        </>
      }
      actions={
        isAdmin && (
          <button
            type="button"
            className="a-btn a-btn-outline !py-1 text-[11px]"
            onClick={() => setCreating(true)}
          >
            <PlusIcon className="h-3.5 w-3.5" />
            {t("admin.vector.newCol")}
          </button>
        )
      }
    >
      <div className="flex items-center justify-between gap-2">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder={t("admin.vector.searchCol")}
          className="w-full max-w-xs"
        />
        <span className="shrink-0 text-[11px] text-ink-subtle tnum">
          {t("admin.vector.colCount", { n: rows.length })}
        </span>
      </div>

      {!rows.length ? (
        <p className="py-4 text-center text-[--text-sm] text-ink-subtle">
          {collections.length
            ? t("admin.vector.noColMatch")
            : t("admin.vector.noCol")}
        </p>
      ) : (
        /*
          格子而不是一条行：展开带里每行只放两三个集合，剩下 90% 宽度是空的。
          auto-fill + minmax 让一行随视口落到 4~7 个，不必为断点写死列数。
          元信息（文档数/已索引）贴在名字下面一行内，不单独占行 ——
          集合名和它的描述本来就是一个语义单元，拆成两行反而要眼睛来回找。
        */
        <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2">
          {rows.map((col) => {
            const docs = documentsByCollection.get(col.id) ?? [];
            const indexed = docs.filter(
              (d) => d.meta?.index_status === "indexed",
            ).length;
            const failed = docs.filter(
              (d) => d.meta?.index_status === "failed",
            ).length;
            return (
              <li key={col.id} className="min-w-0">
                <Link
                  to={`/admin/vector/${database.id}/${col.id}`}
                  className="flex h-full flex-col gap-1 rounded-[--radius-md] border border-line bg-surface px-2.5 py-2 transition-ui hover:border-accent-border hover:bg-surface-sunken"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <LayersIcon className="h-3.5 w-3.5 shrink-0 text-ink-subtle" />
                    <span className="min-w-0 flex-1 truncate text-[--text-sm] font-medium text-ink">
                      {col.name}
                    </span>
                    {failed > 0 && (
                      <span
                        className="shrink-0 rounded-full bg-danger-soft px-1.5 text-[10px] text-danger tnum"
                        title={t("admin.vector.failedN", { n: failed })}
                      >
                        {failed}
                      </span>
                    )}
                  </span>
                  {/* 描述与计数共用一行：名字长时各自截断，谁也不把谁挤下去 */}
                  <span className="flex min-w-0 items-baseline justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-[10px] text-ink-subtle">
                      {col.description || t("ui.noDescription")}
                    </span>
                    <span className="shrink-0 text-[10px] text-ink-muted tnum">
                      {docs.length}/{indexed}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={t("admin.vector.newCol")}
        description={t("admin.vector.newColDesc", { name: database.name })}
        footer={
          <>
            <button
              type="button"
              className="a-btn a-btn-ghost"
              onClick={() => setCreating(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="a-btn a-btn-primary"
              disabled={create.isPending || !form.name.trim()}
              onClick={() =>
                create.mutate(
                  {
                    name: form.name.trim(),
                    description: form.description.trim(),
                  },
                  {
                    onSuccess: () => {
                      setCreating(false);
                      setForm({ name: "", description: "" });
                    },
                  },
                )
              }
            >
              {create.isPending ? t("common.creating") : t("common.create")}
            </button>
          </>
        }
      >
        <div className="space-y-3.5">
          <TextInput
            label={t("common.name")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t("admin.vector.colNameExample")}
            autoFocus
            hint={t("admin.vector.colNameHint")}
          />
          <TextInput
            label={t("common.description")}
            optional={t("auth.optionalField")}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
      </Modal>
    </Disclosure>
  );
}

function DatabaseList({
  databases,
  collectionsByDb,
  documentsByCollection,
  expandedId,
}: {
  databases: KbDatabase[];
  collectionsByDb: Map<number, KbCollection[]>;
  documentsByCollection: Map<number, KbDocument[]>;
  /** 由 URL 决定展开哪一个：折叠态是可分享、可刷新的位置，不是临时 UI 状态 */
  expandedId: number | null;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", tenant_id: "" });

  const { data: tenants } = useTenants();
  const create = useCreateDatabase();

  const needle = query.trim().toLowerCase();
  const rows = useMemo(() => {
    return databases
      .filter(
        (db) =>
          !needle ||
          db.name.toLowerCase().includes(needle) ||
          (db.description ?? "").toLowerCase().includes(needle) ||
          // 搜索要能穿过折叠层：只按库名搜的话，知道集合名就找不到它所在的库
          (collectionsByDb.get(db.id) ?? []).some(
            (c) =>
              c.name.toLowerCase().includes(needle) ||
              (c.description ?? "").toLowerCase().includes(needle),
          ),
      )
      .sort((a, b) => a.name.localeCompare(b.name, intlLocale()));
  }, [databases, needle, collectionsByDb]);

  return (
    <>
      <PageHeader
        title={t("page.vector")}
        description={t("admin.vector.pageDesc")}
        actions={
          isAdmin && (
            <button
              type="button"
              className="a-btn a-btn-primary"
              onClick={() => setCreating(true)}
            >
              <PlusIcon className="h-4 w-4" />
              {t("admin.vector.newDb")}
            </button>
          )
        }
      />

      <Panel
        bodyClass="px-3 py-3"
        title={t("admin.vector.dbCount", { n: databases.length })}
        actions={
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder={t("admin.vector.searchDb")}
            className="w-56"
          />
        }
      >
        {!rows.length ? (
          <EmptyState
            icon={LibraryIcon}
            title={needle ? t("admin.vector.noDbMatch") : t("admin.vector.noDb")}
            description={
              needle ? t("common.tryKeyword") : t("admin.vector.noDbDesc")
            }
            action={
              needle || !isAdmin ? undefined : (
                <button
                  type="button"
                  className="a-btn a-btn-primary"
                  onClick={() => setCreating(true)}
                >
                  <PlusIcon className="h-4 w-4" />
                  {t("admin.vector.newDb")}
                </button>
              )
            }
          />
        ) : (
          <div className="space-y-2">
            {rows.map((db) => (
              <DatabaseRow
                key={db.id}
                database={db}
                collections={collectionsByDb.get(db.id) ?? []}
                documentsByCollection={documentsByCollection}
                expanded={expandedId === db.id}
                onOpen={() => navigate(`/admin/vector/${db.id}`)}
                onClose={() => navigate("/admin/vector")}
              />
            ))}
          </div>
        )}
      </Panel>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title={t("admin.vector.newDb")}
        description={t("admin.vector.newDbDesc")}
        footer={
          <>
            <button
              type="button"
              className="a-btn a-btn-ghost"
              onClick={() => setCreating(false)}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="a-btn a-btn-primary"
              disabled={create.isPending || !form.name.trim()}
              onClick={() =>
                create.mutate(
                  {
                    name: form.name.trim(),
                    description: form.description.trim(),
                    tenant_id: form.tenant_id ? Number(form.tenant_id) : null,
                  },
                  { onSuccess: () => setCreating(false) },
                )
              }
            >
              {create.isPending ? t("common.creating") : t("common.create")}
            </button>
          </>
        }
      >
        <div className="space-y-3.5">
          <TextInput
            label={t("common.name")}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder={t("admin.vector.dbNameExample")}
            autoFocus
          />
          <TextInput
            label={t("common.description")}
            optional={t("auth.optionalField")}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder={t("admin.vector.dbDescPlaceholder")}
          />
          <Select
            label={t("admin.vector.tenantLabel")}
            value={form.tenant_id}
            onChange={(v) => setForm({ ...form, tenant_id: String(v) })}
            placeholder={t("admin.vector.tenantNoneOption")}
            panelClassName="w-full"
            options={[
              // 自绘 listbox 的 placeholder 不可选中，「不绑定租户」必须是真选项
              { value: "", label: t("admin.vector.tenantNoneOption") },
              ...(tenants ?? []).map((tenant) => ({
                value: String(tenant.id),
                label: tenant.name,
              })),
            ]}
            hint={t("admin.vector.tenantHint")}
          />
        </div>
      </Modal>
    </>
  );
}

/* ─────────────── 第三级：文档与分块 ─────────────── */
/* ─────────────── 检索预览（命中测试） ─────────────── */

/**
 * 给一句话，看这个集合到底召回了什么、分数多少 —— 不调用大模型。
 *
 * 这是同类产品里排障价值最高的一个入口：「回答不对」其实是三种不同的病 ——
 * 没召回到、召回到但排序靠后、召回也排第一但模型没用好。
 * 没有这个面板就只能改 .env 重启再猜，而三种病的解法完全不同。
 * 刻意不跑大模型：既快又省，也不会把预览算进用量配额。
 */
function RecallPanel({
  database,
  collection,
}: {
  database: KbDatabase;
  collection: KbCollection;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rerank, setRerank] = useState(true);
  const [topK, setTopK] = useState(10);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RecallResult | null>(null);

  const run = async () => {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    try {
      setResult(
        await documentAPI.recall({
          collection_name: collection.name,
          database_name: database.name,
          query: q,
          top_k: topK,
          rerank,
        }),
      );
    } catch (e) {
      toast(t("admin.vector.recallFailed", { msg: (e as Error).message }), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="a-card mb-4 overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left"
      >
        <ChevronRightIcon
          className={`h-3.5 w-3.5 shrink-0 text-ink-subtle transition-ui ${open ? "rotate-90" : ""}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-[--text-sm] font-medium text-ink">
            {t("admin.vector.recallTitle")}
          </span>
          <span className="block truncate text-[11px] text-ink-subtle">
            {t("admin.vector.recallDesc")}
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t border-line-subtle px-3.5 py-3">
          <div className="flex flex-wrap items-end gap-2">
            <TextInput
              label={t("admin.vector.recallQuery")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("admin.vector.recallPlaceholder")}
              className="min-w-[12rem] flex-1"
            />
            <Select
              aria-label={t("chat.topK")}
              label={t("admin.vector.recallTopK")}
              value={topK}
              onChange={(v) => setTopK(Number(v))}
              className="!w-24"
              options={[5, 10, 20, 30].map((n) => ({ value: n, label: String(n) }))}
            />
            <button
              type="button"
              className="a-btn a-btn-primary"
              disabled={busy || !query.trim()}
              onClick={run}
            >
              {busy ? t("common.loading") : t("admin.vector.recallRun")}
            </button>
          </div>

          <div className="mt-2">
            <Toggle checked={rerank} onChange={setRerank} label={t("admin.vector.recallUseRerank")} />
          </div>

          {result && (
            <div className="mt-3">
              <p className="mb-2 text-[11px] text-ink-subtle tnum">
                {t("admin.vector.recallSummary", {
                  mode: result.mode,
                  candidates: result.candidate_count,
                  returned: result.returned,
                })}
              </p>
              {!result.results.length ? (
                <p className="rounded-[--radius-md] border border-warning-border bg-warning-soft px-3 py-2 text-[--text-sm] text-ink">
                  {t("admin.vector.recallEmpty")}
                </p>
              ) : (
                <ol className="space-y-2">
                  {result.results.map((h, i) => (
                    <li
                      key={`${h.doc_id}-${h.chunk_id}`}
                      className="rounded-[--radius-md] border border-line bg-surface-sunken p-2.5"
                    >
                      <div className="mb-1 flex items-center gap-2 text-[10px] text-ink-subtle tnum">
                        <span className="a-badge border-line bg-surface text-ink-subtle">
                          #{i + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {h.document_title || String(h.doc_id).slice(0, 8)}
                        </span>
                        <span>
                          {result.mode === "rerank"
                            ? t("admin.vector.recallScore", {
                                n: (h.relevance_score ?? 0).toFixed(4),
                              })
                            : t("admin.vector.recallDistance", {
                                n: (h.relevance_score ?? 0).toFixed(3),
                              })}
                        </span>
                      </div>
                      <p className="line-clamp-3 whitespace-pre-wrap text-[--text-sm] leading-relaxed text-ink">
                        {h.text}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


function ChunkRow({
  chunk,
  ordinal,
  canWrite,
  busy,
  onToggle,
  onSave,
  onDelete,
}: {
  chunk: KbChunk;
  ordinal: number;
  canWrite: boolean;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onSave: (content: string) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(chunk.content ?? "");
  const enabled = chunk.enabled !== false;
  const trimmed = draft.trim();

  return (
    <li className="rounded-[--radius-md] border border-line bg-surface-sunken p-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className="a-badge border-line bg-surface text-ink-subtle tnum">
          #{ordinal}
        </span>
        <span className="a-badge border-line bg-surface text-ink-subtle tnum">
          chunk_id {chunk.id}
        </span>
        {/* 停用不是删除：内容还在，只是不进检索。标出来才知道为什么召不回它。 */}
        {!enabled && (
          <span className="a-badge border-warning-border bg-warning-soft text-warning">
            {t("admin.vector.chunkOffBadge")}
          </span>
        )}
        <span className="ml-auto text-[11px] text-ink-subtle tnum">
          {t("admin.vector.charsN", { n: (chunk.content ?? "").length })}
        </span>
      </div>

      {editing ? (
        <div className="space-y-2">
          <TextArea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={6}
            aria-label={t("admin.vector.chunkEditAria", { n: chunk.id })}
          />
          {/* 改正文会重算这一块的向量：只改关系库的文本、向量留在原处，
              检索就会按旧内容召回新内容，分数与文字从此对不上且一声不响。 */}
          <p className="text-[11px] leading-relaxed text-ink-subtle">
            {t("admin.vector.chunkEditHint")}
          </p>
          <div className="flex justify-end gap-1.5">
            <button
              type="button"
              className="a-btn a-btn-ghost !py-1 text-[11px]"
              disabled={busy}
              onClick={() => {
                setDraft(chunk.content ?? "");
                setEditing(false);
              }}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="a-btn a-btn-primary !py-1 text-[11px]"
              disabled={busy || !trimmed || trimmed === (chunk.content ?? "").trim()}
              onClick={() => {
                onSave(trimmed);
                setEditing(false);
              }}
            >
              {t("common.save")}
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-[--text-sm] leading-relaxed text-ink">
            {chunk.content}
          </p>
          {canWrite && (
            <div className="mt-2 flex justify-end gap-1.5">
              <button
                type="button"
                className="a-btn a-btn-outline !py-1 text-[11px]"
                disabled={busy}
                onClick={() => onToggle(!enabled)}
              >
                {enabled
                  ? t("admin.vector.chunkOff")
                  : t("admin.vector.chunkOn")}
              </button>
              <button
                type="button"
                className="a-btn a-btn-outline !py-1 text-[11px]"
                disabled={busy}
                onClick={() => setEditing(true)}
              >
                {t("common.edit")}
              </button>
              <button
                type="button"
                className="a-btn a-btn-danger !py-1 text-[11px]"
                disabled={busy}
                onClick={onDelete}
              >
                {t("common.del")}
              </button>
            </div>
          )}
        </>
      )}
    </li>
  );
}

function ChunkViewer({
  documentId,
  documentTitle,
  canWrite,
  onClose,
}: {
  documentId: number;
  documentTitle: string;
  canWrite: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const { data: chunks, isLoading } = useChunks(documentId);
  const [page, setPage] = useState(1);
  const paged = paginate(chunks ?? [], page);
  const docId = String(documentId);

  const toggle = useSetChunkEnabled();
  const update = useUpdateChunk();
  const remove = useDeleteChunk();
  const busy = toggle.isPending || update.isPending || remove.isPending;
  const offCount = (chunks ?? []).filter((c) => c.enabled === false).length;

  return (
    <Modal
      open
      onClose={onClose}
      title={documentTitle}
      description={
        offCount
          ? t("admin.vector.chunkOffTotal", { total: paged.total, off: offCount })
          : t("admin.vector.chunkTotal", { n: paged.total })
      }
      width="max-w-2xl"
      footer={
        <Pagination paged={paged} onPageChange={setPage} />
      }
    >
      {isLoading ? (
        <Loading label={t("admin.vector.loadingChunks")} />
      ) : !paged.items.length ? (
        <EmptyState
          title={t("admin.vector.noChunks")}
          description={t("admin.vector.noChunksDesc")}
        />
      ) : (
        <ol className="space-y-2">
          {paged.items.map((chunk, i) => (
            <ChunkRow
              key={chunk.id}
              chunk={chunk}
              ordinal={paged.offset + i + 1}
              canWrite={canWrite}
              busy={busy}
              onToggle={(enabled) =>
                toggle.mutate({ docId, chunkId: chunk.id, enabled })
              }
              onSave={(content) => update.mutate({ docId, chunkId: chunk.id, content })}
              onDelete={() =>
                confirm({
                  title: t("admin.vector.deleteChunkTitle", { n: chunk.id }),
                  message: t("admin.vector.deleteChunkMsg"),
                  confirmLabel: t("common.del"),
                  tone: "danger",
                }).then((ok) => ok && remove.mutate({ docId, chunkId: chunk.id }))
              }
            />
          ))}
        </ol>
      )}
    </Modal>
  );
}

function DocumentList({
  database,
  collection,
  documents,
}: {
  database: KbDatabase;
  collection: KbCollection;
  documents: KbDocument[];
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const isAdmin = useIsAdmin();
  const remove = useDeleteDocument();
  const toggleDoc = useSetDocumentEnabled();
  const stats = useChunkStats(collection.id);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [viewing, setViewing] = useState<KbDocument | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = useUploadDocument({ onUploaded: () => setUploading(false) });

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return documents
      .filter((d) => !needle || (d.title ?? "").toLowerCase().includes(needle))
      .sort(
        (a, b) =>
          +new Date(b.created_at ?? 0) - +new Date(a.created_at ?? 0),
      );
  }, [documents, query]);

  const paged = paginate(rows, page);

  const submitFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setUploading(true);
    upload.mutate({
      file,
      collectionName: collection.name,
      databaseName: database.name,
    });
  };

  const columns: Column<KbDocument>[] = [
    {
      key: "title",
      header: t("common.document"),
      cell: (doc) => (
        <div className="flex items-center gap-2.5">
          <FileIcon className="h-4 w-4 shrink-0 text-ink-subtle" />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">
              {doc.title || t("rag.untitled")}
            </p>
            <p className="truncate text-[11px] text-ink-subtle">
              {doc.uploader
                ? t("admin.vector.uploader", { name: doc.uploader })
                : t("admin.vector.uploaderUnknown")}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: t("admin.vector.indexStatus"),
      width: "10rem",
      cell: (doc) => <IndexStatusBadge doc={doc} />,
    },
    {
      key: "chunks",
      header: t("common.chunks"),
      align: "right",
      width: "6rem",
      hideBelow: "sm",
      cell: (doc) => {
        // 现算的 enabled/total 优先；meta.chunk_count 只在统计没回来时兜底，
        // 因为它是上传时写死的一次性数字，删过一块就不会自己变小。
        const s = stats.data?.[String(doc.id)];
        return (
          <span
            className={`tnum ${
              s && s.enabled < s.total ? "text-warning" : "text-ink-muted"
            }`}
          >
            {s ? `${s.enabled}/${s.total}` : (doc.meta?.chunk_count ?? "—")}
          </span>
        );
      },
    },
    {
      key: "created",
      header: t("admin.vector.uploadedAt"),
      align: "right",
      width: "9rem",
      hideBelow: "md",
      cell: (doc) => (
        <span className="tnum text-ink-subtle">
          {doc.created_at?.slice(0, 10) || "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "right",
      width: "12rem",
      cell: (doc) => {
        const s = stats.data?.[String(doc.id)];
        // 整篇的开关只是「把它的所有分块一起翻」的快捷方式，状态从现算的计数读，
        // 不再额外存一份文档级开关（两处都能表达同一件事时，就会出现没人定义过的组合）。
        const allOff = !!s && s.enabled === 0;
        return (
          <div className="flex flex-wrap justify-end gap-1.5">
            <button
              type="button"
              className="a-btn a-btn-outline !py-1 text-[11px]"
              onClick={() => setViewing(doc)}
            >
              {t("admin.vector.viewChunks")}
            </button>
            {isAdmin && (
              <button
                type="button"
                className="a-btn a-btn-outline !py-1 text-[11px]"
                disabled={toggleDoc.isPending || !s}
                onClick={() =>
                  toggleDoc.mutate({
                    docId: String(doc.id),
                    enabled: !allOff,
                  })
                }
              >
                {allOff
                  ? t("admin.vector.docOn")
                  : t("admin.vector.docOff")}
              </button>
            )}
            {/* 知识库原来只能往里加：传错了、传重了都清不掉。
                删除是破坏性动作，所以只在管理员视角出现，且必须过确认。 */}
            {isAdmin && (
              <button
                type="button"
                className="a-btn a-btn-danger !py-1 text-[11px]"
                disabled={remove.isPending}
                onClick={() =>
                  confirm({
                    title: t("admin.vector.deleteDocTitle", {
                      name: doc.title || t("rag.untitled"),
                    }),
                    message: t("admin.vector.deleteDocMsg"),
                    confirmLabel: t("common.del"),
                    tone: "danger",
                  }).then((ok) => ok && remove.mutate(String(doc.id)))
                }
              >
                {t("common.del")}
              </button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title={collection.name}
        description={t("admin.vector.docPageDesc", { db: database.name })}
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: t("page.vector"), to: "/admin/vector" },
              { label: database.name, to: `/admin/vector/${database.id}` },
              { label: collection.name },
            ]}
          />
        }
      />

      <RecallPanel database={database} collection={collection} />

      <div className="mb-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            submitFiles(e.dataTransfer.files);
          }}
          className={`a-card flex flex-col items-center justify-center gap-2 px-6 py-8 text-center transition-colors ${
            dragging ? "border-accent bg-accent-soft" : ""
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            hidden
            accept=".pdf,.doc,.docx,.txt,.md,.csv,.xls,.xlsx,.ppt,.pptx,.html,.epub,.eml,.png,.jpg,.jpeg"
            onChange={(e) => {
              submitFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface-sunken text-ink-subtle">
            <UploadIcon className="h-4 w-4" />
          </span>
          <p className="text-[--text-sm] text-ink">
            {t("admin.vector.dropHint")}
            <button
              type="button"
              className="mx-1 text-accent-ink underline decoration-accent-border underline-offset-2 hover:decoration-accent"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              {t("admin.vector.pickFile")}
            </button>
            {t("admin.vector.uploadTo", { name: collection.name })}
          </p>
          <p className="text-[11px] text-ink-subtle">
            {t("admin.vector.formats")}
          </p>
          {uploading && (
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-accent-ink">
              <Loading label="" />
              {t("admin.vector.indexing")}
            </p>
          )}
        </div>
      </div>

      <Panel
        title={t("admin.vector.docCount", { n: documents.length })}
        bodyClass="px-4 py-3"
        actions={
          <SearchInput
            value={query}
            onValueChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
            placeholder={t("admin.vector.searchDoc")}
            className="w-56"
          />
        }
        footer={
          <Pagination paged={paged} onPageChange={setPage} />
        }
      >
        <DataTable
          columns={columns}
          rows={paged.items}
          rowKey={(doc) => doc.id}
          empty={
            <EmptyState
              icon={BookIcon}
              title={
                query ? t("admin.vector.noDocMatch") : t("admin.vector.noDoc")
              }
              description={
                query
                  ? t("common.tryKeyword")
                  : t("admin.vector.noDocDesc")
              }
            />
          }
        />
      </Panel>

      {viewing && (
        <ChunkViewer
          documentId={viewing.id}
          documentTitle={viewing.title || t("rag.untitled")}
          canWrite={isAdmin}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  );
}

/* ─────────────── 路由分发 ─────────────── */

// 加载中的骨架要按 URL 深度给：整页换成一个转圈会让页头、面板、表格集体塌陷，
// 数据到位后所有内容一起下跳；更深的问题是第一帧没有 databases，
// resolveDrilldown 会把一个合法深链判成「这个知识库不存在」——假报错。
// 只剩两种骨架：集合已经并入知识库列表的展开带，不再是独立的一页。
// 表头存文案键：模块级常量存译文的话，切语言后骨架仍然是旧语言。
const SKELETON_LEVELS = {
  list: [
    { key: "name", headerKey: "common.database" },
    { key: "tenant", headerKey: "common.tenant", width: "12rem" },
    { key: "collections", headerKey: "common.collection", width: "6rem", align: "right" },
  ],
  documents: [
    { key: "title", headerKey: "common.document" },
    { key: "status", headerKey: "admin.vector.indexStatus", width: "10rem" },
    { key: "chunks", headerKey: "common.chunks", width: "5rem", align: "right" },
    { key: "created", headerKey: "admin.vector.uploadedAt", width: "9rem", align: "right" },
  ],
} as const;

function ConsoleSkeleton({ depth }: { depth: 0 | 2 }) {
  const { t } = useI18n();
  const columns: Column<never>[] = (depth === 2
    ? SKELETON_LEVELS.documents
    : SKELETON_LEVELS.list
  ).map((c) => ({
    key: c.key,
    header: t(c.headerKey),
    width: "width" in c ? c.width : undefined,
    align: "align" in c ? c.align : undefined,
    cell: () => null,
  }));
  return (
    <div
      className="mx-auto w-full max-w-[68rem] px-4 py-6 md:px-8"
      aria-busy="true"
      aria-label={t("admin.vector.loadingKb")}
    >
      {depth === 2 && <span className="skeleton mb-3 block h-3 w-28" />}
      <div className="mb-5 space-y-2">
        <span className="skeleton block h-6 w-44" />
        <span className="skeleton block h-3 w-80" />
      </div>
      <Panel
        bodyClass="px-4 py-3"
        title={<span className="skeleton inline-block h-3.5 w-24 align-middle" />}
        actions={<span className="skeleton block h-7 w-56" />}
      >
        <DataTable columns={columns} rows={[]} rowKey={() => 0} loading />
      </Panel>
    </div>
  );
}

export default function AdminVectorPage() {
  const { t } = useI18n();
  const { dbId, colId } = useParams<{ dbId?: string; colId?: string }>();
  const {
    databases,
    collectionsByDb,
    documentsByCollection,
    isLoading,
    error,
  } = useKnowledgeIndex();

  if (isLoading) return <ConsoleSkeleton depth={colId ? 2 : 0} />;

  if (error)
    return (
      <div className="mx-auto w-full max-w-[68rem] px-4 py-6 md:px-8">
        <Panel>
          <EmptyState
            icon={LibraryIcon}
            title={t("admin.vector.loadFailed")}
            description={
              error instanceof Error ? error.message : t("admin.vector.backendDown")
            }
          />
        </Panel>
      </div>
    );

  const view = resolveDrilldown(databases, collectionsByDb, dbId, colId);
  const missing =
    view.level === "database-missing" || view.level === "collection-missing";

  return (
    <div className="mx-auto w-full max-w-[68rem] px-4 py-6 md:px-8">
      {/* databases 与 collections 渲染同一个列表，区别只是哪一行展开着：
          集合不再是独立的一页。URL 仍然是 /admin/vector/:dbId，
          所以深链、刷新、后退的行为都没有变。 */}
      {(view.level === "databases" || view.level === "collections") && (
        <DatabaseList
          databases={databases}
          collectionsByDb={collectionsByDb}
          documentsByCollection={documentsByCollection}
          expandedId={view.level === "collections" ? view.database.id : null}
        />
      )}
      {view.level === "documents" && (
        <DocumentList
          database={view.database}
          collection={view.collection}
          documents={documentsByCollection.get(view.collection.id) ?? []}
        />
      )}
      {missing && (
        <Panel>
          <EmptyState
            icon={LibraryIcon}
            title={
              view.level === "database-missing"
                ? t("admin.vector.dbMissing")
                : t("admin.vector.colMissing")
            }
            description={
              view.level === "database-missing"
                ? t("admin.vector.dbMissingDesc", { id: view.dbId })
                : t("admin.vector.colMissingDesc", {
                    name: view.database.name,
                    id: view.colId,
                  })
            }
            action={
              <Link
                to={
                  view.level === "database-missing"
                    ? "/admin/vector"
                    : `/admin/vector/${view.database.id}`
                }
                className="a-btn a-btn-primary"
              >
                {view.level === "database-missing"
                  ? t("admin.vector.backToDbList")
                  : t("admin.vector.backToDb", { name: view.database.name })}
              </Link>
            }
          />
        </Panel>
      )}
    </div>
  );
}
