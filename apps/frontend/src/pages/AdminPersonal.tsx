import { useQuery } from "@tanstack/react-query";
import { personalAPI, type PersonalAdminRow } from "../api/personal";
import { intlLocale } from "../i18n";
import { useI18n } from "../i18n/context";
import {
  Breadcrumbs,
  DataTable,
  EmptyState,
  PageHeader,
  Panel,
  StatusBadge,
  type Column,
} from "../components/ui";

type Translate = ReturnType<typeof useI18n>["t"];

function quotaText(used: number, limit: number, unlimited: boolean, t: Translate) {
  if (unlimited) return t("admin.personal.unlimited");
  return `${used.toLocaleString(intlLocale())} / ${limit.toLocaleString(intlLocale())}`;
}

function columnsFor(t: Translate): Column<PersonalAdminRow>[] {
  return [
    {
      key: "user",
      header: t("admin.personal.user"),
      cell: (row) => (
        <div>
          <p className="font-medium text-ink">{row.user?.name ?? "—"}</p>
          <p className="text-[11px] text-ink-subtle">{row.user?.email ?? row.tenant}</p>
        </div>
      ),
    },
    {
      key: "ledger",
      header: t("admin.personal.ledger"),
      width: "8rem",
      align: "right",
      cell: (row) => (
        <span className="tnum">
          {row.speech_rows} / {row.ledger_rows}
        </span>
      ),
    },
    {
      key: "last",
      header: t("admin.personal.last"),
      width: "10rem",
      cell: (row) => (row.last_at ? row.last_at.slice(0, 10) : "—"),
    },
    {
      key: "daily",
      header: t("admin.personal.daily"),
      width: "12rem",
      align: "right",
      cell: (row) =>
        row.usage
          ? quotaText(row.usage.daily, row.usage.daily_limit,
              row.usage.daily_unlimited, t)
          : "—",
    },
    {
      key: "monthly",
      header: t("admin.personal.monthly"),
      width: "12rem",
      align: "right",
      cell: (row) =>
        row.usage
          ? quotaText(row.usage.monthly, row.usage.monthly_limit,
              row.usage.monthly_unlimited, t)
          : "—",
    },
    {
      key: "status",
      header: t("admin.personal.status"),
      width: "7rem",
      cell: (row) => (
        <StatusBadge tone={row.user?.is_active ? "success" : "neutral"} dot>
          {row.user?.is_active ? t("admin.personal.active") : t("admin.personal.disabled")}
        </StatusBadge>
      ),
    },
  ];
}

export default function AdminPersonalPage() {
  const { t } = useI18n();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["personal", "admin", "overview"],
    queryFn: personalAPI.adminOverview,
  });

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: t("page.personalAdmin") }]} />
      <PageHeader
        title={t("admin.personal.title")}
        description={t("admin.personal.desc")}
        actions={
          <button type="button" className="a-btn a-btn-ghost" onClick={() => refetch()}>
            {t("admin.personal.refresh")}
          </button>
        }
      />
      <Panel bodyClass="p-0">
        <DataTable
          columns={columnsFor(t)}
          rows={data ?? []}
          rowKey={(row) => row.tenant_id}
          loading={isLoading}
          error={error}
          onRetry={() => refetch()}
          empty={<EmptyState title={t("admin.personal.empty")} />}
        />
      </Panel>
    </div>
  );
}
