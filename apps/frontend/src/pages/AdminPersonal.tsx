import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { personalAPI, type PersonalAdminRow } from "../api/personal";
import { intlLocale } from "../i18n";
import { useI18n } from "../i18n/context";
import { useToast } from "../hooks/useToast";
import {
  Breadcrumbs,
  DataTable,
  EmptyState,
  Modal,
  PageHeader,
  Panel,
  StatusBadge,
  TextInput,
  type Column,
} from "../components/ui";

type Translate = ReturnType<typeof useI18n>["t"];

function quotaText(used: number, limit: number, unlimited: boolean, t: Translate) {
  if (unlimited) return t("admin.personal.unlimited");
  return `${used.toLocaleString(intlLocale())} / ${limit.toLocaleString(intlLocale())}`;
}

function columnsFor(
  t: Translate,
  onEdit: (row: PersonalAdminRow) => void,
): Column<PersonalAdminRow>[] {
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
      key: "actions",
      header: "",
      width: "6rem",
      align: "right",
      cell: (row) => (
        <button
          type="button"
          className="a-btn a-btn-ghost !px-2 !py-0.5 text-[11px]"
          disabled={!row.user}
          onClick={() => onEdit(row)}
        >
          {t("admin.personal.editQuota")}
        </button>
      ),
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

function QuotaEditor({
  row,
  saving,
  onSave,
}: {
  row: PersonalAdminRow;
  saving: boolean;
  onSave: (daily: number, monthly: number) => void;
}) {
  const { t } = useI18n();
  const [daily, setDaily] = useState(String(row.usage?.daily_limit ?? 0));
  const [monthly, setMonthly] = useState(String(row.usage?.monthly_limit ?? 0));
  const dailyNumber = Number(daily);
  const monthlyNumber = Number(monthly);
  const valid = Number.isInteger(dailyNumber) && dailyNumber >= 0
    && Number.isInteger(monthlyNumber) && monthlyNumber >= 0;
  return (
    <div className="space-y-3 px-4 pb-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput
          label={t("admin.personal.dailyLimit")}
          type="number"
          min={0}
          value={daily}
          onChange={(e) => setDaily(e.target.value)}
          hint={t("admin.personal.zeroUnlimited")}
        />
        <TextInput
          label={t("admin.personal.monthlyLimit")}
          type="number"
          min={0}
          value={monthly}
          onChange={(e) => setMonthly(e.target.value)}
          hint={t("admin.personal.zeroUnlimited")}
        />
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className="a-btn a-btn-primary"
          disabled={!valid || saving}
          onClick={() => onSave(dailyNumber, monthlyNumber)}
        >
          {t("admin.personal.save")}
        </button>
      </div>
    </div>
  );
}

export default function AdminPersonalPage() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<PersonalAdminRow | null>(null);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["personal", "admin", "overview"],
    queryFn: personalAPI.adminOverview,
  });
  const saveQuota = useMutation({
    mutationFn: (input: { userId: number; daily: number; monthly: number }) =>
      personalAPI.updateQuota(input.userId, input.daily, input.monthly),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["personal", "admin", "overview"] });
      toast(t("admin.personal.saved"), "success");
      setEditing(null);
    },
    onError: (err: Error) =>
      toast(t("admin.personal.saveFailed", { msg: err.message }), "error"),
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
          columns={columnsFor(t, (row) => setEditing(row))}
          rows={data ?? []}
          rowKey={(row) => row.tenant_id}
          loading={isLoading}
          error={error}
          onRetry={() => refetch()}
          empty={<EmptyState title={t("admin.personal.empty")} />}
        />
      </Panel>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={t("admin.personal.quotaTitle", {
          name: editing?.user?.name ?? "",
        })}
        description={t("admin.personal.quotaDesc")}
        width="max-w-lg"
      >
        {editing && (
          <QuotaEditor
            key={editing.user?.id}
            row={editing}
            saving={saveQuota.isPending}
            onSave={(daily, monthly) =>
              saveQuota.mutate({
                userId: editing.user!.id,
                daily,
                monthly,
              })
            }
          />
        )}
      </Modal>
    </div>
  );
}
