import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { personalAPI } from "../api/personal";
import { useCurrentUser } from "../hooks/useAuth";
import { useToast } from "../hooks/useToast";
import { useI18n } from "../i18n/context";
import {
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  Panel,
  SearchInput,
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
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const [query, setQuery] = useState("");
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
  const search = useQuery({
    queryKey: ["personal", "search", query],
    queryFn: () => personalAPI.search(query, 20),
    enabled: personal && query.trim().length > 0,
  });
  const keep = useMutation({
    mutationFn: (eventId: string) => personalAPI.keep(eventId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["personal"] });
      toast(t("personal.kept"), "success");
    },
    onError: (error: Error) =>
      toast(t("personal.keepFailed", { msg: error.message }), "error"),
  });
  const weeks = useQuery({
    queryKey: ["personal", "periods", "week"],
    queryFn: () => personalAPI.periods("week"),
    enabled: personal,
  });
  const ontology = useQuery({
    queryKey: ["personal", "ontology"],
    queryFn: personalAPI.ontology,
    enabled: personal,
  });
  const aliases = useQuery({
    queryKey: ["personal", "aliases"],
    queryFn: personalAPI.aliases,
    enabled: personal,
  });
  const [refText, setRefText] = useState("");
  const resolve = useMutation({
    mutationFn: (text: string) => personalAPI.resolve(text),
  });
  const decisions = useQuery({
    queryKey: ["personal", "decisions"],
    queryFn: personalAPI.decisions,
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
            <Panel title={t("personal.searchTitle")}
              description={t("personal.searchDesc")}>
              <div className="px-4 py-3">
                <SearchInput
                  value={query}
                  onValueChange={setQuery}
                  placeholder={t("personal.searchPlaceholder")}
                />
                {query.trim() && (
                  <div className="mt-3">
                    {search.isLoading ? (
                      <Loading />
                    ) : search.data?.length ? (
                      <ul className="divide-y divide-line-subtle">
                        {search.data.map((row) => (
                          <li key={row.id} className="flex gap-3 py-2">
                            <span className="w-20 shrink-0 font-mono text-[11px] text-ink-subtle">
                              {row.id}
                            </span>
                            <span className="min-w-0 flex-1 text-[--text-sm] text-ink">
                              {row.text}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <EmptyState title={t("personal.searchEmpty")} />
                    )}
                  </div>
                )}
              </div>
            </Panel>
          </div>

          <div className="mt-4">
            <Panel title={t("personal.recent")}
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
                        {item.phase === "labile" && (
                          <button
                            type="button"
                            className="a-btn a-btn-ghost !px-2 !py-0.5 text-[11px]"
                            disabled={keep.isPending}
                            onClick={() => keep.mutate(item.event_id)}
                          >
                            {t("personal.keep")}
                          </button>
                        )}
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
        <Panel title={t("personal.ontology")} description={t("personal.ontologyDesc")}>
          {ontology.isLoading ? (
            <Loading />
          ) : ontology.isError ? (
            <ErrorState error={ontology.error} onRetry={() => ontology.refetch()} />
          ) : ontology.data ? (
            <div className="px-4 py-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["entities", "personal.entities"],
                  ["relations", "personal.relations"],
                  ["states", "personal.states"],
                  ["events", "personal.events"],
                ].map(([key, label]) => (
                  <div key={key}>
                    <p className="text-[11px] text-ink-subtle">{t(label as never)}</p>
                    <p className="text-[--text-lg] font-semibold text-ink tnum">
                      {ontology.data.counts[key as keyof typeof ontology.data.counts]}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {ontology.data.entities.slice(0, 24).map((entity) => (
                  <span key={entity.id} className="a-badge border-line bg-surface-sunken text-ink-muted">
                    {entity.type}:{entity.label}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState title={t("personal.empty")} />
          )}
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title={t("personal.resolve")} description={t("personal.resolveDesc")}>
          <div className="px-4 py-3">
            <div className="flex gap-2">
              <SearchInput
                value={refText}
                onValueChange={setRefText}
                placeholder={t("personal.resolvePlaceholder")}
                className="flex-1"
              />
              <button
                type="button"
                className="a-btn a-btn-primary"
                disabled={!refText.trim() || resolve.isPending}
                onClick={() => resolve.mutate(refText)}
              >
                {t("personal.resolveAction")}
              </button>
            </div>
            {resolve.data && (
              <ul className="mt-3 divide-y divide-line-subtle">
                {resolve.data.phrases.length ? (
                  resolve.data.phrases.map((item, index) => (
                    <li key={`${item.phrase}-${index}`} className="py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[--text-sm] font-medium text-ink">
                          {item.phrase}
                        </span>
                        <StatusBadge
                          tone={item.status === "resolved" ? "success" : "warning"}
                        >
                          {item.status === "resolved"
                            ? t("personal.resolved")
                            : t("personal.unresolved")}
                        </StatusBadge>
                        <span className="ml-auto text-[11px] text-ink-subtle">
                          {item.labels?.join(" / ")}
                        </span>
                      </div>
                      {item.reason && (
                        <p className="mt-1 text-[11px] text-ink-subtle">{item.reason}</p>
                      )}
                    </li>
                  ))
                ) : (
                  <EmptyState title={t("personal.noReferences")} />
                )}
              </ul>
            )}
            {aliases.data?.groups.length ? (
              <p className="mt-3 text-[11px] text-ink-subtle">
                {t("personal.groups", {
                  names: aliases.data.groups.map((g) => g.name).join("、"),
                })}
              </p>
            ) : null}
          </div>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title={t("personal.decisions")} description={t("personal.decisionsDesc")}>
          {decisions.isLoading ? (
            <Loading />
          ) : decisions.isError ? (
            <ErrorState error={decisions.error} onRetry={() => decisions.refetch()} />
          ) : decisions.data?.length ? (
            <ul className="divide-y divide-line-subtle">
              {decisions.data.slice(0, 10).map((lead) => (
                <li key={`${lead.event_id}-${lead.seq}`} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-ink-subtle">
                      {lead.event_id}
                    </span>
                    <StatusBadge tone={lead.status === "active" ? "success" : "neutral"}>
                      {t(lead.status === "active" ? "personal.active" : "personal.expired")}
                    </StatusBadge>
                    <span className="text-[11px] text-ink-subtle">{lead.actor}</span>
                    <span className="ml-auto text-[11px] text-ink-subtle">
                      {lead.marker}
                    </span>
                  </div>
                  <p className="mt-1 text-[--text-sm] text-ink">{lead.excerpt}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={t("personal.empty")} />
          )}
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title={t("personal.periods")} description={t("personal.periodsDesc")}>
          {weeks.isLoading ? (
            <Loading />
          ) : weeks.isError ? (
            <ErrorState error={weeks.error} onRetry={() => weeks.refetch()} />
          ) : weeks.data?.length ? (
            <ul className="grid grid-cols-2 gap-px bg-line-subtle sm:grid-cols-4">
              {weeks.data.slice(-8).map((week) => (
                <li key={week.period_key} className="bg-surface px-4 py-3">
                  <p className="text-[11px] text-ink-subtle tnum">{week.period_key}</p>
                  <p className="mt-0.5 text-[--text-lg] font-semibold text-ink tnum">
                    {week.item_count}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={t("personal.empty")} />
          )}
        </Panel>
      </div>

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
