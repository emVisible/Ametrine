import { useQuery } from "@tanstack/react-query";
import { personalAPI } from "../api/personal";
import { useCurrentUser } from "../hooks/useAuth";
import { useI18n } from "../i18n/context";
import {
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  Panel,
  StatusBadge,
} from "../components/ui";
import { SparkIcon } from "../components/icons";

const PHASE_KEY = {
  labile: "personal.phase.labile",
  stable: "personal.phase.stable",
  dormant: "personal.phase.dormant",
  barred: "personal.phase.barred",
  retired: "personal.phase.retired",
} as const;

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="a-card px-4 py-3">
      <p className="text-[11px] text-ink-subtle">{label}</p>
      <p className="mt-0.5 text-[--text-xl] font-semibold text-ink tnum">{value}</p>
    </div>
  );
}

export default function PersonalPage() {
  const { t } = useI18n();
  const { data: user } = useCurrentUser();
  const personal = user?.tenant_mode === "personal";
  const memory = useQuery({
    queryKey: ["personal", "memory"],
    queryFn: personalAPI.memory,
    enabled: personal,
  });
  const ledger = useQuery({
    queryKey: ["personal", "ledger"],
    queryFn: () => personalAPI.ledger(12),
    enabled: personal,
  });

  if (!personal) {
    return (
      <div className="mx-auto w-full max-w-[64rem] px-4 py-6 md:px-8">
        <PageHeader title={t("personal.title")} />
        <EmptyState
          icon={SparkIcon}
          title={t("personal.notPersonalTitle")}
          description={t("personal.notPersonalDesc")}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[64rem] px-4 py-6 md:px-8">
      <PageHeader
        title={t("personal.title")}
        description={t("personal.desc")}
      />

      {memory.isLoading ? (
        <Loading label={t("personal.loading")} />
      ) : memory.isError ? (
        <ErrorState error={memory.error} onRetry={() => memory.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label={t("personal.holding")} value={memory.data?.holding ?? 0} />
            <Stat label={t("personal.labile")} value={memory.data?.counts.labile ?? 0} />
            <Stat label={t("personal.stable")} value={memory.data?.counts.stable ?? 0} />
            <Stat label={t("personal.barred")} value={memory.data?.counts.barred ?? 0} />
          </div>

          <div className="mt-4">
            <Panel
              title={t("personal.recent")}
              description={t("personal.recentDesc", {
                count: memory.data?.items.length ?? 0,
              })}
            >
              {memory.data?.items.length ? (
                <ul className="divide-y divide-line-subtle">
                  {memory.data.items.map((item) => (
                    <li key={item.event_id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-ink-subtle">
                          {item.event_id}
                        </span>
                        <StatusBadge
                          tone={item.phase === "stable" ? "success" : "accent"}
                          dot
                        >
                          {t(PHASE_KEY[item.phase])}
                        </StatusBadge>
                        <span className="text-[11px] text-ink-subtle">
                          {item.date} · {item.actor}
                        </span>
                        <span className="ml-auto text-[11px] text-ink-subtle tnum">
                          {t("personal.strength", { value: item.strength })}
                        </span>
                      </div>
                      <p className="mt-1 text-[--text-sm] text-ink">{item.excerpt}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title={t("personal.empty")} />
              )}
            </Panel>
          </div>
        </>
      )}

      <div className="mt-4">
        <Panel title={t("personal.ledger")} description={t("personal.ledgerDesc")}>
          {ledger.isLoading ? (
            <Loading />
          ) : ledger.isError ? (
            <ErrorState error={ledger.error} onRetry={() => ledger.refetch()} />
          ) : ledger.data?.length ? (
            <ul className="divide-y divide-line-subtle">
              {ledger.data.map((row) => (
                <li key={row.id} className="flex gap-3 px-4 py-2.5">
                  <span className="w-20 shrink-0 font-mono text-[11px] text-ink-subtle">
                    {row.id}
                  </span>
                  <span className="w-14 shrink-0 text-[11px] text-ink-subtle">
                    {row.actor}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[--text-sm] text-ink">
                    {row.text}
                  </span>
                  <span className="shrink-0 text-[11px] text-ink-subtle">
                    {row.occurred_at.slice(0, 10)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={t("personal.empty")} />
          )}
        </Panel>
      </div>
    </div>
  );
}
