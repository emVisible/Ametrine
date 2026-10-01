// src/pages/AdminQueue.tsx
// 未解决与差评队列。#15（对话历史）、#11（反馈）、#10（静态问答）在这里汇成一件具体的事：
// 先看「哪些回答不值得信」，再一跳进到那个集合的分块面板去修它。
// 刻意不做「自动改回答」：这里的每一行都是给人看的工单，不是给模型学的样本。
import { useState } from "react";
import { useNavigate } from "react-router";
import type { UnresolvedRow } from "../api/converstion";
import {
  ArrowUpRightIcon,
  CheckIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "../components/icons";
import {
  Breadcrumbs,
  DataTable,
  EmptyState,
  PageHeader,
  Panel,
  StatusBadge,
  Tabs,
  type Column,
} from "../components/ui";
import {
  useDatabases,
  useSetMessageFeedback,
  useUnresolved,
} from "../hooks/queries";
import { useI18n } from "../i18n/context";
import { describeRetrieval } from "../utils/retrievalCopy";

type Translate = ReturnType<typeof useI18n>["t"];

const FILTERS = ["all", "no_reference", "failed", "down"] as const;
type Filter = (typeof FILTERS)[number];

export default function AdminQueue() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const { data, isLoading, error, refetch } = useUnresolved();
  const databases = useDatabases();

  const rows = data ?? [];
  const counts: Record<Filter, number> = {
    all: rows.length,
    no_reference: rows.filter((r) => r.status === "no_reference").length,
    failed: rows.filter((r) => r.status === "failed").length,
    down: rows.filter((r) => r.verdict === "down").length,
  };
  const visible = rows.filter((row) => {
    if (filter === "all") return true;
    if (filter === "down") return row.verdict === "down";
    return row.status === filter;
  });

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: t("page.queue") }]} />
      <PageHeader
        title={t("queue.title")}
        description={t("queue.desc")}
        actions={
          <button
            type="button"
            className="a-btn a-btn-ghost"
            onClick={() => refetch()}
          >
            {t("queue.refresh")}
          </button>
        }
      />

      <Tabs
        ariaLabel={t("queue.filtersAria")}
        value={filter}
        onChange={setFilter}
        items={FILTERS.map((key) => ({
          key,
          label: t(`queue.filter.${key}`),
          badge: counts[key],
        }))}
      />

      <Panel bodyClass="p-0">
        <DataTable
          columns={columnsFor(t, databases.data ?? [], navigate)}
          rows={visible}
          rowKey={(r) => r.message_id}
          loading={isLoading}
          error={error}
          onRetry={() => refetch()}
          empty={
            <EmptyState
              icon={CheckIcon}
              title={t("queue.empty")}
              description={t("queue.emptyDesc")}
            />
          }
        />
      </Panel>
    </div>
  );
}

/** 把一条检索事实压成一行可读的判据 —— 实现在 utils/retrievalCopy.ts：
 *  页面文件只导出组件，否则整个模块失去 fast refresh。 */
function columnsFor(
  t: Translate,
  databases: { id: number; name: string }[],
  navigate: (to: string) => void,
): Column<UnresolvedRow>[] {
  return [
    {
      key: "status",
      header: t("queue.col.status"),
      width: "10rem",
      cell: (row) => <StatusCell row={row} />,
    },
    {
      key: "content",
      header: t("queue.col.answer"),
      cell: (row) => (
        <div className="min-w-0">
          <p className="line-clamp-2 text-[13px] text-ink">
            {row.content || t("queue.emptyAnswer")}
          </p>
          <p className="mt-1 truncate text-[11px] text-ink-subtle">
            {row.asked_by} · {row.conversation_title}
            {row.note ? ` · ${row.note}` : ""}
          </p>
          {/* 检索证据放在这一列（始终可见），而不是放进窄屏就隐藏的「库/时间」列：
              这一行存在的意义就是「为什么没答对」，把它做成响应式里第一个被丢掉的信息，
              等于在手机上看队列时又回到了「只有抱怨、没有依据」。 */}
          {row.retrieval ? (
            <p className="tnum mt-0.5 truncate text-[11px] text-ink-subtle">
              {describeRetrieval(row.retrieval, t)}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      key: "kb",
      header: t("queue.col.kb"),
      width: "13rem",
      hideBelow: "sm",
      cell: (row) => (
        <div className="min-w-0 text-[12px]">
          <p className="truncate text-ink-muted">
            {row.database_name ?? t("queue.kbUnknown")}
            {row.collection_name ? ` / ${row.collection_name}` : ""}
          </p>
          <p className="tnum mt-0.5 text-[11px] text-ink-subtle">
            {row.created_at ? row.created_at.slice(0, 16).replace("T", " ") : ""}
          </p>
        </div>
      ),
    },
    {
      key: "actions",
      header: t("queue.col.actions"),
      align: "right",
      width: "12rem",
      cell: (row) => {
        // 队列里带的是当时回答用的**库名**，跳转要 id；解析不到就明说，不硬编链接
        const db = databases.find((d) => d.name === row.database_name);
        return (
          <div className="flex items-center justify-end gap-2">
            <RowActions row={row} />
            {db ? (
              <button
                type="button"
                className="a-btn a-btn-ghost h-7 px-2.5"
                onClick={() => navigate(`/admin/vector/${db.id}`)}
              >
                {t("queue.fix")}
                <ArrowUpRightIcon className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : (
              <span className="text-[11px] text-ink-subtle">
                {t("queue.kbMissing")}
              </span>
            )}
          </div>
        );
      },
    },
  ];
}

function StatusCell({ row }: { row: UnresolvedRow }) {
  const { t } = useI18n();
  const tone =
    row.status === "failed"
      ? "danger"
      : row.status === "no_reference"
        ? "warning"
        : "neutral";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <StatusBadge tone={tone}>
        {row.status === "no_reference"
          ? t("queue.status.no_reference")
          : row.status === "failed"
            ? t("queue.status.failed")
            : t("queue.status.other")}
      </StatusBadge>
      {row.verdict === "down" && (
        <span className="inline-flex items-center gap-1 text-[11px] text-warning">
          <ThumbsDownIcon className="h-3 w-3" aria-hidden />
          {t("queue.downvote")}
        </span>
      )}
      {row.verdict === "up" && (
        <span className="inline-flex items-center gap-1 text-[11px] text-ink-subtle">
          <ThumbsUpIcon className="h-3 w-3" aria-hidden />
          {t("queue.upvote")}
        </span>
      )}
    </div>
  );
}

/** 每一行自己的 mutation，所以「提交中」只禁用这一行的按钮。 */
function RowActions({ row }: { row: UnresolvedRow }) {
  const { t } = useI18n();
  const feedback = useSetMessageFeedback();
  const pending = feedback.isPending;
  return (
    <>
      <button
        type="button"
        className="a-btn a-btn-ghost h-7 w-7 p-0"
        aria-label={t("queue.markGood")}
        title={t("queue.markGood")}
        disabled={pending}
        onClick={() =>
          feedback.mutate({ messageId: row.message_id, verdict: "up" })
        }
      >
        <CheckIcon className="h-3.5 w-3.5" aria-hidden />
      </button>
      <button
        type="button"
        className="a-btn a-btn-ghost h-7 w-7 p-0 text-warning"
        aria-label={t("queue.markBad")}
        title={t("queue.markBad")}
        disabled={pending}
        onClick={() =>
          feedback.mutate({
            messageId: row.message_id,
            verdict: "down",
            note: t("queue.autoNote"),
          })
        }
      >
        <ThumbsDownIcon className="h-3.5 w-3.5" aria-hidden />
      </button>
    </>
  );
}
