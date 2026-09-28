// src/pages/AdminVector.tsx
// 知识库控制台：知识库 → 集合 → 文档 三级下钻，层级由 URL 决定（可分享深链、刷新不丢位置）。
// 原先三个平铺 tab 各自重复「选库→选集合→列卡片」的逻辑，且上传后 window.location.reload()。
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
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
  const status = doc.meta?.index_status;
  // 后端只在成功时写 chunk_count、失败时写 index_error，缺失必须容错
  if (status === "indexed")
    return (
      <StatusBadge tone="success" dot title={`${doc.meta?.chunk_count ?? 0} 个分块`}>
        已索引
      </StatusBadge>
    );
  if (status === "failed")
    return (
      <StatusBadge tone="danger" dot title={doc.meta?.index_error || "索引失败"}>
        索引失败
      </StatusBadge>
    );
  if (status === "pending")
    return (
      <StatusBadge tone="warning" dot>
        排队中
      </StatusBadge>
    );
  return <StatusBadge tone="neutral">无索引信息</StatusBadge>;
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
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [databases, query]);

  const paged = paginate(rows, page);

  const columns: Column<KbDatabase>[] = [
    {
      key: "name",
      header: "知识库",
      cell: (db) => (
        <div className="flex items-center gap-2.5">
          <DatabaseIcon className="h-4 w-4 shrink-0 text-ink-subtle" />
          <div className="min-w-0">
            <p className="flex items-center gap-2 truncate font-medium text-ink">
              {db.name}
              {/* 整列都是「可用」时徽章没有信息量，只标异常 */}
              {db.is_active === false && (
                <StatusBadge tone="neutral">停用</StatusBadge>
              )}
            </p>
            <p className="truncate text-[11px] text-ink-subtle">
              {db.description || "暂无描述"}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "tenant",
      header: "租户",
      hideBelow: "md",
      width: "12rem",
      cell: (db) =>
        db.tenant_name ? (
          <span className="text-ink-muted">{db.tenant_name}</span>
        ) : (
          <span className="text-ink-subtle">未绑定</span>
        ),
    },
    {
      key: "collections",
      header: "集合",
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
        title="知识库"
        description="每个知识库对应一个独立的向量库命名空间，集合在其内部分隔检索范围"
        actions={
          <button
            type="button"
            className="a-btn a-btn-primary"
            onClick={() => setCreating(true)}
          >
            <PlusIcon className="h-4 w-4" />
            新建知识库
          </button>
        }
      />

      <Panel
        bodyClass="px-4 py-3"
        title={`共 ${databases.length} 个知识库`}
        actions={
          <SearchInput
            value={query}
            onValueChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
            placeholder="搜索知识库"
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
              title={query ? "没有匹配的知识库" : "还没有知识库"}
              description={
                query
                  ? "换个关键词试试。"
                  : "先创建一个知识库，再在其中建立集合并上传文档。"
              }
              action={
                query ? undefined : (
                  <button
                    type="button"
                    className="a-btn a-btn-primary"
                    onClick={() => setCreating(true)}
                  >
                    <PlusIcon className="h-4 w-4" />
                    新建知识库
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
        title="新建知识库"
        description="名称将同时用作 Milvus 数据库名，创建后不可重命名"
        footer={
          <>
            <button
              type="button"
              className="a-btn a-btn-ghost"
              onClick={() => setCreating(false)}
            >
              取消
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
              {create.isPending ? "创建中…" : "创建"}
            </button>
          </>
        }
      >
        <div className="space-y-3.5">
          <TextInput
            label="名称"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="例如：技术文档库"
            autoFocus
          />
          <TextInput
            label="描述"
            optional="选填"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="这个知识库收录什么"
          />
          <Select
            label="归属租户"
            value={form.tenant_id}
            onChange={(e) => setForm({ ...form, tenant_id: e.target.value })}
            placeholder="不绑定（全局知识库）"
            options={(tenants ?? []).map((t) => ({
              value: t.id,
              label: t.name,
            }))}
            hint="一个租户最多绑定一个知识库，绑定后该知识库仅对该租户成员开放"
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
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }, [collections, query]);
  const paged = paginate(rows, page);

  const columns: Column<KbCollection>[] = [
    {
      key: "name",
      header: "集合",
      cell: (col) => (
        <div className="flex items-center gap-2.5">
          <LayersIcon className="h-4 w-4 shrink-0 text-ink-subtle" />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{col.name}</p>
            <p className="truncate text-[11px] text-ink-subtle">
              {col.description || "暂无描述"}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "documents",
      header: "文档",
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
      header: "创建时间",
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
        description={database.description || "暂无描述"}
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: "知识库", to: "/admin/vector" },
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
            新建集合
          </button>
        }
      />

      <Panel
        title={`共 ${collections.length} 个集合`}
        bodyClass="px-4 py-3"
        actions={
          <SearchInput
            value={query}
            onValueChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
            placeholder="搜索集合"
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
              title={query ? "没有匹配的集合" : "这个知识库还没有集合"}
              description={
                query
                  ? "换个关键词试试，集合名和描述都会参与匹配。"
                  : "集合是上传文档的单位，也是检索时的选择粒度。"
              }
              action={
                query ? undefined : (
                  <button
                    type="button"
                    className="a-btn a-btn-primary"
                    onClick={() => setCreating(true)}
                  >
                    <PlusIcon className="h-4 w-4" />
                    新建集合
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
        title="新建集合"
        description={`集合名将作为 Milvus collection 在「${database.name}」下创建`}
        footer={
          <>
            <button
              type="button"
              className="a-btn a-btn-ghost"
              onClick={() => setCreating(false)}
            >
              取消
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
              {create.isPending ? "创建中…" : "创建"}
            </button>
          </>
        }
      >
        <div className="space-y-3.5">
          <TextInput
            label="名称"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="例如：2026-Q3"
            autoFocus
            hint="集合名在全局范围内唯一，跨知识库同名会被拒绝"
          />
          <TextInput
            label="描述"
            optional="选填"
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
  const { data: chunks, isLoading } = useChunks(documentId);
  const [page, setPage] = useState(1);
  const paged = paginate(chunks ?? [], page);

  return (
    <Modal
      open
      onClose={onClose}
      title={documentTitle}
      description={`共 ${paged.total} 个分块`}
      width="max-w-2xl"
      footer={
        <Pagination paged={paged} onPageChange={setPage} />
      }
    >
      {isLoading ? (
        <Loading label="正在读取分块…" />
      ) : !paged.items.length ? (
        <EmptyState title="没有分块记录" description="该文档可能索引失败。" />
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
                  {chunk.content?.length ?? 0} 字
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
      header: "文档",
      cell: (doc) => (
        <div className="flex items-center gap-2.5">
          <FileIcon className="h-4 w-4 shrink-0 text-ink-subtle" />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">
              {doc.title || "未命名"}
            </p>
            <p className="truncate text-[11px] text-ink-subtle">
              {doc.uploader ? `上传者 ${doc.uploader}` : "上传者未知"}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "索引状态",
      width: "10rem",
      cell: (doc) => <IndexStatusBadge doc={doc} />,
    },
    {
      key: "chunks",
      header: "分块",
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
      header: "上传时间",
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
          查看分块
        </button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={collection.name}
        description={`知识库 ${database.name} · 上传后由后端同步完成分块与索引`}
        breadcrumb={
          <Breadcrumbs
            items={[
              { label: "知识库", to: "/admin/vector" },
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
            拖入文件，或
            <button
              type="button"
              className="mx-1 text-accent-ink underline decoration-accent-border underline-offset-2 hover:decoration-accent"
              onClick={() => inputRef.current?.click()}
              disabled={uploading}
            >
              选择文件
            </button>
            上传到「{collection.name}」
          </p>
          <p className="text-[11px] text-ink-subtle">
            支持 PDF、Word、Markdown、TXT、CSV、图片等格式；单个文件依次入库
          </p>
          {uploading && (
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-accent-ink">
              <Loading label="" />
              正在解析、分块并建立索引…
            </p>
          )}
        </div>
      </div>

      <Panel
        title={`共 ${documents.length} 个文档`}
        bodyClass="px-4 py-3"
        actions={
          <SearchInput
            value={query}
            onValueChange={(v) => {
              setQuery(v);
              setPage(1);
            }}
            placeholder="搜索文档标题"
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
              title={query ? "没有匹配的文档" : "还没有文档"}
              description={
                query ? "换个关键词试试。" : "用上方的上传区把第一份文档放进这个集合。"
              }
            />
          }
        />
      </Panel>

      {viewing && (
        <ChunkViewer
          documentId={viewing.id}
          documentTitle={viewing.title || "未命名文档"}
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
const SKELETON_LEVELS: Record<0 | 1 | 2, { columns: Column<never>[] }> = {
  0: {
    columns: [
      { key: "name", header: "知识库", cell: () => null },
      { key: "tenant", header: "租户", width: "12rem", cell: () => null },
      { key: "collections", header: "集合", width: "6rem", align: "right", cell: () => null },
    ],
  },
  1: {
    columns: [
      { key: "name", header: "集合", cell: () => null },
      { key: "docs", header: "文档", width: "6rem", align: "right", cell: () => null },
      { key: "created", header: "创建时间", width: "9rem", align: "right", cell: () => null },
    ],
  },
  2: {
    columns: [
      { key: "title", header: "文档", cell: () => null },
      { key: "status", header: "索引状态", width: "10rem", cell: () => null },
      { key: "chunks", header: "分块", width: "5rem", align: "right", cell: () => null },
      { key: "created", header: "上传时间", width: "9rem", align: "right", cell: () => null },
    ],
  },
};

function ConsoleSkeleton({ depth }: { depth: 0 | 1 | 2 }) {
  const level = SKELETON_LEVELS[depth];
  return (
    <div
      className="mx-auto w-full max-w-[68rem] px-4 py-6 md:px-8"
      aria-busy="true"
      aria-label="正在读取知识库"
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
        <DataTable columns={level.columns} rows={[]} rowKey={() => 0} loading />
      </Panel>
    </div>
  );
}

export default function AdminVectorPage() {
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
            title="无法读取知识库"
            description={error instanceof Error ? error.message : "请确认后端已启动"}
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
                ? "这个知识库不存在"
                : "这个集合不存在"
            }
            description={
              view.level === "database-missing"
                ? `编号 ${view.dbId} 的知识库可能已被删除，或属于另一个租户。`
                : `「${view.database.name}」里没有编号为 ${view.colId} 的集合，可能已被删除。`
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
                  ? "返回知识库列表"
                  : `回到「${view.database.name}」`}
              </Link>
            }
          />
        </Panel>
      )}
    </div>
  );
}
