// src/pages/AdminVector.tsx
// 知识库控制台：知识库 → 集合 → 文档 三级下钻，层级由 URL 决定（可分享深链、刷新不丢位置）。
// 原先三个平铺 tab 各自重复「选库→选集合→列卡片」的逻辑，且上传后 window.location.reload()。
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useI18n } from "../i18n/context";
import { intlLocale } from "../i18n";
import { resolveDrilldown } from "../utils/drilldown";
import { paginate } from "../utils/pagination";
import {
  Breadcrumbs,
  DataTable,
  EmptyState,
  Loading,
  Modal,
  PageHeader,
  Pagination,
  Panel,
  SearchInput,
  Select,
  StatusBadge,
  TextInput,
  type Column,
} from "../components/ui";
import {
  useCreateCollection,
  useCreateDatabase,
  useKnowledgeIndex,
  useTenants,
  useUploadDocument,
} from "../hooks/queries";
import { useChunks } from "../hooks/queries";
import type { KbCollection, KbDatabase, KbDocument } from "../types/knowledge";
import {
  BookIcon,
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

/* ─────────────── 第一级：知识库 ─────────────── */

function DatabaseList({
  databases,
  collectionsByDb,
}: {
  databases: KbDatabase[];
  collectionsByDb: Map<number, KbCollection[]>;
}) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", tenant_id: "" });

  const { data: tenants } = useTenants();
  const create = useCreateDatabase();

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return databases
      .filter(
        (db) =>
          !needle ||
          db.name.toLowerCase().includes(needle) ||
          (db.description ?? "").toLowerCase().includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name, intlLocale()));
  }, [databases, query]);

  const paged = paginate(rows, page);

  const columns: Column<KbDatabase>[] = [
    {
      key: "name",
      header: t("common.database"),
      cell: (db) => (
        <div className="flex items-center gap-2.5">
          <DatabaseIcon className="h-4 w-4 shrink-0 text-ink-subtle" />
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate font-medium text-ink">
              {db.name}
              {/* 整列都是「可用」时徽章没有信息量，只标异常 */}
              {db.is_active === false && (
                <StatusBadge tone="neutral">{t("common.inactive")}</StatusBadge>
              )}
            </p>
            <p className="truncate text-[11px] text-ink-subtle">
              {db.description || t("ui.noDescription")}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "tenant",
      header: t("common.tenant"),
      hideBelow: "md",
      width: "12rem",
      cell: (db) =>
        db.tenant_name ? (
          <span className="text-ink-muted">{db.tenant_name}</span>
        ) : (
          <span className="text-ink-subtle">{t("admin.vector.unbound")}</span>
        ),
    },
    {
      key: "collections",
      header: t("common.collection"),
      align: "right",
      width: "6rem",
      cell: (db) => (
        <span className="tnum text-ink-muted">
          {collectionsByDb.get(db.id)?.length ?? 0}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("page.vector")}
        description={t("admin.vector.pageDesc")}
        actions={
          <button
            type="button"
            className="a-btn a-btn-primary"
            onClick={() => setCreating(true)}
          >
            <PlusIcon className="h-4 w-4" />
            {t("admin.vector.newDb")}
          </button>
        }
      />

      <Panel
        bodyClass="px-4 py-3"
        title={t("admin.vector.dbCount", { n: databases.length })}
        actions={
          <SearchInput
            value={query}
            onValueChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
            placeholder={t("admin.vector.searchDb")}
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
          rowKey={(db) => db.id}
          onRowClick={(db) => navigate(`/admin/vector/${db.id}`)}
          empty={
            <EmptyState
              icon={LibraryIcon}
              title={
                query ? t("admin.vector.noDbMatch") : t("admin.vector.noDb")
              }
              description={
                query
                  ? t("common.tryKeyword")
                  : t("admin.vector.noDbDesc")
              }
              action={
                query ? undefined : (
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
          }
        />
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
            onChange={(e) => setForm({ ...form, tenant_id: e.target.value })}
            placeholder={t("admin.vector.tenantNoneOption")}
            options={(tenants ?? []).map((tenant) => ({
              value: tenant.id,
              label: tenant.name,
            }))}
            hint={t("admin.vector.tenantHint")}
          />
        </div>
      </Modal>
    </>
  );
}

/* ─────────────── 第二级：集合 ─────────────── */

function CollectionList({
  database,
  collections,
  documentsByCollection,
}: {
  database: KbDatabase;
  collections: KbCollection[];
  documentsByCollection: Map<number, KbDocument[]>;
}) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState({ name: "", description: "" });
  const create = useCreateCollection(database.id);

  // 与上层知识库列表同一套交互：集合名可能很长且数量不少，按名字过滤是这里唯一有用的检索维度
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
  const paged = paginate(rows, page);

  const columns: Column<KbCollection>[] = [
    {
      key: "name",
      header: t("common.collection"),
      cell: (col) => (
        <div className="flex items-center gap-2.5">
          <LayersIcon className="h-4 w-4 shrink-0 text-ink-subtle" />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{col.name}</p>
            <p className="truncate text-[11px] text-ink-subtle">
              {col.description || t("ui.noDescription")}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "documents",
      header: t("common.document"),
      align: "right",
      width: "6rem",
      cell: (col) => (
        <span className="tnum text-ink-muted">
          {documentsByCollection.get(col.id)?.length ?? 0}
        </span>
      ),
    },
    {
      key: "created",
      header: t("common.createdAt"),
      align: "right",
      width: "10rem",
      hideBelow: "md",
      cell: (col) => (
        <span className="tnum text-ink-subtle">
          {col.created_at?.slice(0, 10) || "—"}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={database.name}
        description={database.description || t("ui.noDescription")}
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: t("page.vector"), to: "/admin/vector" },
              { label: database.name },
            ]}
          />
        }
        actions={
          <button
            type="button"
            className="a-btn a-btn-primary"
            onClick={() => setCreating(true)}
          >
            <PlusIcon className="h-4 w-4" />
            {t("admin.vector.newCol")}
          </button>
        }
      />

      <Panel
        title={t("admin.vector.colCount", { n: collections.length })}
        bodyClass="px-4 py-3"
        actions={
          <SearchInput
            value={query}
            onValueChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
            placeholder={t("admin.vector.searchCol")}
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
          rowKey={(col) => col.id}
          onRowClick={(col) => navigate(`/admin/vector/${database.id}/${col.id}`)}
          empty={
            <EmptyState
              icon={LayersIcon}
              title={
                query ? t("admin.vector.noColMatch") : t("admin.vector.noCol")
              }
              description={
                query
                  ? t("admin.vector.colSearchHint")
                  : t("admin.vector.noColDesc")
              }
              action={
                query ? undefined : (
                  <button
                    type="button"
                    className="a-btn a-btn-primary"
                    onClick={() => setCreating(true)}
                  >
                    <PlusIcon className="h-4 w-4" />
                    {t("admin.vector.newCol")}
                  </button>
                )
              }
            />
          }
        />
      </Panel>

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
    </>
  );
}

/* ─────────────── 第三级：文档与分块 ─────────────── */

function ChunkViewer({
  documentId,
  documentTitle,
  onClose,
}: {
  documentId: number;
  documentTitle: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { data: chunks, isLoading } = useChunks(documentId);
  const [page, setPage] = useState(1);
  const paged = paginate(chunks ?? [], page);

  return (
    <Modal
      open
      onClose={onClose}
      title={documentTitle}
      description={t("admin.vector.chunkTotal", { n: paged.total })}
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
            <li
              key={chunk.id}
              className="rounded-[--radius-md] border border-line bg-surface-sunken p-3"
            >
              <div className="mb-1.5 flex items-center gap-2">
                <span className="a-badge border-line bg-surface text-ink-subtle tnum">
                  #{paged.offset + i + 1}
                </span>
                <span className="a-badge border-line bg-surface text-ink-subtle tnum">
                  chunk_id {chunk.id}
                </span>
                <span className="ml-auto text-[11px] text-ink-subtle tnum">
                  {t("admin.vector.charsN", { n: chunk.content?.length ?? 0 })}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-[--text-sm] leading-relaxed text-ink">
                {chunk.content}
              </p>
            </li>
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
      width: "5rem",
      hideBelow: "sm",
      cell: (doc) => (
        <span className="tnum text-ink-muted">
          {doc.meta?.chunk_count ?? "—"}
        </span>
      ),
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
      width: "6rem",
      cell: (doc) => (
        <button
          type="button"
          className="a-btn a-btn-outline !py-1 text-[11px]"
          onClick={() => setViewing(doc)}
        >
          {t("admin.vector.viewChunks")}
        </button>
      ),
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
// 表头存文案键：模块级常量存译文的话，切语言后骨架仍然是旧语言。
const SKELETON_LEVELS: Record<
  0 | 1 | 2,
  {
    key: string;
    headerKey: string;
    width?: string;
    align?: "left" | "right" | "center";
  }[]
> = {
  0: [
    { key: "name", headerKey: "common.database" },
    { key: "tenant", headerKey: "common.tenant", width: "12rem" },
    { key: "collections", headerKey: "common.collection", width: "6rem", align: "right" },
  ],
  1: [
    { key: "name", headerKey: "common.collection" },
    { key: "docs", headerKey: "common.document", width: "6rem", align: "right" },
    { key: "created", headerKey: "common.createdAt", width: "9rem", align: "right" },
  ],
  2: [
    { key: "title", headerKey: "common.document" },
    { key: "status", headerKey: "admin.vector.indexStatus", width: "10rem" },
    { key: "chunks", headerKey: "common.chunks", width: "5rem", align: "right" },
    { key: "created", headerKey: "admin.vector.uploadedAt", width: "9rem", align: "right" },
  ],
};

function ConsoleSkeleton({ depth }: { depth: 0 | 1 | 2 }) {
  const { t } = useI18n();
  const columns: Column<never>[] = SKELETON_LEVELS[depth].map((c) => ({
    key: c.key,
    header: t(c.headerKey),
    width: c.width,
    align: c.align,
    cell: () => null,
  }));
  return (
    <div
      className="mx-auto w-full max-w-[68rem] px-4 py-6 md:px-8"
      aria-busy="true"
      aria-label={t("admin.vector.loadingKb")}
    >
      {depth > 0 && <span className="skeleton mb-3 block h-3 w-28" />}
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

  if (isLoading)
    return <ConsoleSkeleton depth={colId ? 2 : dbId ? 1 : 0} />;

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
      {view.level === "databases" && (
        <DatabaseList
          databases={databases}
          collectionsByDb={collectionsByDb}
        />
      )}
      {view.level === "collections" && (
        <CollectionList
          database={view.database}
          collections={collectionsByDb.get(view.database.id) ?? []}
          documentsByCollection={documentsByCollection}
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
