import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { personalAPI } from "../api/personal";
import { useCurrentUser } from "../hooks/useAuth";
import { useToast } from "../hooks/useToast";
import { useI18n } from "../i18n/context";
import {
  EmptyState,
  ErrorState,
  Loading,
  Modal,
  PageHeader,
  Panel,
  SearchInput,
  StatusBadge,
  TextArea,
  TextInput,
} from "../components/ui";
import { SparkIcon } from "../components/icons";

const PHASE_KEY = {
  labile: "personal.phase.labile",
  stable: "personal.phase.stable",
  dormant: "personal.phase.dormant",
  barred: "personal.phase.barred",
  retired: "personal.phase.retired",
} as const;

function EventIdButton({ id, onClick }: { id: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-mono text-[11px] text-ink-subtle hover:text-accent-ink hover:underline"
    >
      {id}
    </button>
  );
}

function SettingsForm({
  initial,
  saving,
  onSave,
  onExport,
  exporting,
}: {
  initial: { actor: string; timezone: string };
  saving: boolean;
  onSave: (body: { actor: string; timezone: string }) => void;
  onExport: () => void;
  exporting: boolean;
}) {
  const { t } = useI18n();
  const [actor, setActor] = useState(initial.actor);
  const [timezone, setTimezone] = useState(initial.timezone);
  return (
    <div className="space-y-3 px-4 py-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInput
          label={t("personal.actorLabel")}
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          hint={t("personal.actorHint")}
        />
        <TextInput
          label={t("personal.timezoneLabel")}
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          hint={t("personal.timezoneHint")}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="a-btn a-btn-primary"
          disabled={saving || !actor.trim() || !timezone.trim()}
          onClick={() => onSave({ actor, timezone })}
        >
          {t("personal.save")}
        </button>
        <button
          type="button"
          className="a-btn a-btn-ghost"
          disabled={exporting}
          onClick={onExport}
        >
          {t("personal.export")}
        </button>
      </div>
    </div>
  );
}

function QuotaBar({
  label,
  used,
  limit,
  unlimited,
}: {
  label: string;
  used: number;
  limit: number;
  unlimited: boolean;
}) {
  const { t } = useI18n();
  const percent = !unlimited && limit > 0
    ? Math.min(100, Math.round((used / limit) * 100))
    : null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] text-ink-subtle">{label}</p>
        <p className="text-[11px] text-ink-muted tnum">
          {unlimited
            ? t("personal.unlimited")
            : `${used.toLocaleString()} / ${limit.toLocaleString()}`}
        </p>
      </div>
      <div className="mt-1 h-[3px] overflow-hidden rounded-full bg-surface-sunken">
        <div
          className={`h-full rounded-full ${percent && percent >= 90 ? "bg-danger" : "bg-accent"}`}
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
    </div>
  );
}

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
  const [scopeMode, setScopeMode] = useState<"personal" | "all" | "vector">("personal");
  const [eventId, setEventId] = useState<string | null>(null);
  const [weekKey, setWeekKey] = useState<string | null>(null);
  const [action, setAction] = useState<
    { kind: "retract" | "expiry"; eventId: string } | null
  >(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [brief, setBrief] = useState<string | null>(null);
  const openEvent = (id: string) => {
    setAction(null);
    setReason("");
    setEventId(id);
  };
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
    enabled: personal && scopeMode === "personal" && query.trim().length > 0,
  });
  const scope = useQuery({
    queryKey: ["personal", "scope-search", query],
    queryFn: () => personalAPI.scopeSearch(query, 20),
    enabled: personal && scopeMode === "all" && query.trim().length > 0,
  });
  const vector = useQuery({
    queryKey: ["personal", "vector-search", query],
    queryFn: () => personalAPI.vectorSearch(query, 20),
    enabled: personal && scopeMode === "vector" && query.trim().length > 0,
  });
  const act = useMutation({
    mutationFn: (input: { kind: "retract" | "expiry"; eventId: string; reason: string }) =>
      input.kind === "retract"
        ? personalAPI.retract(input.eventId, input.reason)
        : personalAPI.expire(input.eventId, input.reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["personal"] });
      toast(t("personal.actionDone"), "success");
      setAction(null);
      setReason("");
      setEventId(null);
    },
    onError: (error: Error) =>
      toast(t("personal.actionFailed", { msg: error.message }), "error"),
  });
  const addNote = useMutation({
    mutationFn: (text: string) => personalAPI.append(text),
    onSuccess: (result) => {
      setNote("");
      setBrief(result.brief.text);
      queryClient.invalidateQueries({ queryKey: ["personal"] });
      toast(t("personal.noteSaved"), "success");
    },
    onError: (error: Error) =>
      toast(t("personal.noteFailed", { msg: error.message }), "error"),
  });
  const bootstrap = useMutation({
    mutationFn: personalAPI.bootstrap,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
    },
    onError: (error: Error) =>
      toast(t("personal.bootstrapFailed", { msg: error.message }), "error"),
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
  const eventDetail = useQuery({
    queryKey: ["personal", "event", eventId],
    queryFn: () => personalAPI.ledgerOne(eventId as string),
    enabled: !!eventId,
  });
  const weekDetail = useQuery({
    queryKey: ["personal", "week", weekKey],
    queryFn: () => personalAPI.period("week", weekKey as string),
    enabled: !!weekKey,
  });
  const weekDigest = useQuery({
    queryKey: ["personal", "digest", "week", weekKey],
    queryFn: () => personalAPI.digest("week", weekKey as string),
    enabled: !!weekKey,
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
  const settings = useQuery({
    queryKey: ["personal", "settings"],
    queryFn: personalAPI.settings,
    enabled: personal,
  });
  const saveSettings = useMutation({
    mutationFn: personalAPI.updateSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["personal", "settings"] });
      toast(t("personal.saved"), "success");
    },
    onError: (error: Error) =>
      toast(t("personal.saveFailed", { msg: error.message }), "error"),
  });
  const exportLedger = useMutation({
    mutationFn: personalAPI.exportLedger,
    onSuccess: (blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "personal-ledger.jsonl";
      link.click();
      URL.revokeObjectURL(url);
    },
    onError: (error: Error) =>
      toast(t("personal.exportFailed", { msg: error.message }), "error"),
  });
  const personalHits = scopeMode === "all"
    ? scope.data?.personal ?? []
    : scopeMode === "personal" ? search.data ?? [] : [];
  const documentHits = scopeMode === "all"
    ? scope.data?.documents ?? []
    : scopeMode === "vector" ? vector.data?.documents ?? [] : [];
  const hitsLoading = scopeMode === "all"
    ? scope.isLoading
    : scopeMode === "vector" ? vector.isLoading : search.isLoading;
  const now = useQuery({
    queryKey: ["personal", "now"],
    queryFn: personalAPI.now,
    enabled: personal,
  });
  const traces = useQuery({
    queryKey: ["personal", "traces"],
    queryFn: () => personalAPI.traces(20),
    enabled: personal,
  });
  const audit = useQuery({
    queryKey: ["personal", "audit"],
    queryFn: () => personalAPI.audit(20),
    enabled: personal,
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
          description={
            user && !user.tenant_id
              ? t("personal.bootstrapDesc")
              : t("personal.notPersonalDesc")
          }
          action={
            user && !user.tenant_id ? (
              <button
                type="button"
                className="a-btn a-btn-primary"
                disabled={bootstrap.isPending}
                onClick={() => bootstrap.mutate()}
              >
                {t("personal.bootstrap")}
              </button>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[64rem] px-4 py-6 md:px-8">
      <PageHeader
        title={t("personal.title")}
        description={t("personal.desc")}
        actions={
          <div className="flex gap-2">
            <Link to="/personal/archive" className="a-btn a-btn-ghost">
              {t("page.archive")}
            </Link>
            <Link to="/personal/day" className="a-btn a-btn-ghost">
              {t("page.day")}
            </Link>
            <Link to="/personal/house" className="a-btn a-btn-ghost">
              {t("page.house")}
            </Link>
          </div>
        }
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
            <Panel title={t("personal.nowTitle")} description={t("personal.nowDesc")}>
              {now.isLoading ? (
                <Loading />
              ) : now.isError ? (
                <ErrorState error={now.error} onRetry={() => now.refetch()} />
              ) : now.data?.last_utterance ? (
                <div className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <EventIdButton
                      id={now.data.last_utterance.event_id}
                      onClick={() => openEvent(now.data!.last_utterance!.event_id)}
                    />
                    <span className="text-[11px] text-ink-subtle">
                      {now.data.last_utterance.actor} · {now.data.gap.label}
                    </span>
                  </div>
                  <p className="mt-1 text-[--text-sm] text-ink">
                    {now.data.last_utterance.text}
                  </p>
                  {now.data.standing.length > 0 && (
                    <div className="mt-3 border-t border-line-subtle pt-2">
                      <p className="text-[11px] text-ink-subtle">
                        {t("personal.standing")}
                      </p>
                      <ul className="mt-1 space-y-1">
                        {now.data.standing.map((lead) => (
                          <li key={lead.event_id} className="text-[11px] text-ink-muted">
                            <EventIdButton
                              id={lead.event_id}
                              onClick={() => openEvent(lead.event_id)}
                            />{" "}
                            {lead.excerpt}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <EmptyState title={t("personal.empty")} />
              )}
            </Panel>
          </div>

          <div className="mt-4">
            <Panel title={t("personal.writeTitle")} description={t("personal.writeDesc")}>
              <div className="space-y-2 px-4 py-3">
                <TextArea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={t("personal.writePlaceholder")}
                  rows={2}
                />
                {brief && (
                  <p className="rounded-[--radius-sm] bg-surface-sunken px-2 py-1.5 text-[11px] text-ink-muted">
                    {brief}
                  </p>
                )}
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="a-btn a-btn-primary"
                    disabled={!note.trim() || addNote.isPending}
                    onClick={() => addNote.mutate(note)}
                  >
                    {t("personal.writeAction")}
                  </button>
                </div>
              </div>
            </Panel>
          </div>

          <div className="mt-4">
            <Panel title={t("personal.quota")} description={t("personal.quotaDesc")}>
              {user ? (
                <div className="grid gap-4 px-4 py-3 sm:grid-cols-2">
                  <QuotaBar
                    label={t("personal.dailyQuota")}
                    used={user.daily_token_used}
                    limit={user.daily_token_limit}
                    unlimited={user.daily_unlimited}
                  />
                  <QuotaBar
                    label={t("personal.monthlyQuota")}
                    used={user.monthly_token_used}
                    limit={user.monthly_token_limit}
                    unlimited={user.monthly_unlimited}
                  />
                </div>
              ) : (
                <Loading />
              )}
            </Panel>
          </div>

          <div className="mt-4">
            <Panel title={t("personal.settings")} description={t("personal.settingsDesc")}>
              {settings.isLoading ? (
                <Loading />
              ) : settings.isError ? (
                <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
              ) : settings.data ? (
                <SettingsForm
                  key={`${settings.data.actor}:${settings.data.timezone}`}
                  initial={settings.data}
                  saving={saveSettings.isPending}
                  onSave={(body) => saveSettings.mutate(body)}
                  onExport={() => exportLedger.mutate()}
                  exporting={exportLedger.isPending}
                />
              ) : null}
            </Panel>
          </div>

          <div className="mt-4">
            <Panel title={t("personal.searchTitle")}
              description={t("personal.searchDesc")}>
              <div className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <SearchInput
                    value={query}
                    onValueChange={setQuery}
                    placeholder={t("personal.searchPlaceholder")}
                    className="min-w-48 flex-1"
                  />
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className={`a-btn !px-2 !py-1 text-[11px] ${scopeMode === "personal" ? "a-btn-primary" : "a-btn-ghost"}`}
                      onClick={() => setScopeMode("personal")}
                    >
                      {t("personal.scopePersonal")}
                    </button>
                    <button
                      type="button"
                      className={`a-btn !px-2 !py-1 text-[11px] ${scopeMode === "all" ? "a-btn-primary" : "a-btn-ghost"}`}
                      onClick={() => setScopeMode("all")}
                    >
                      {t("personal.scopeAll")}
                    </button>
                    <button
                      type="button"
                      className={`a-btn !px-2 !py-1 text-[11px] ${scopeMode === "vector" ? "a-btn-primary" : "a-btn-ghost"}`}
                      onClick={() => setScopeMode("vector")}
                    >
                      {t("personal.scopeVector")}
                    </button>
                  </div>
                </div>
                {query.trim() && (
                  <div className="mt-3">
                    {hitsLoading ? (
                      <Loading />
                    ) : (
                      <>
                        {personalHits.length ? (
                          <ul className="divide-y divide-line-subtle">
                            {personalHits.map((row) => (
                              <li key={row.id} className="flex gap-3 py-2">
                                <span className="w-20 shrink-0">
                                  <EventIdButton id={row.id} onClick={() => openEvent(row.id)} />
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
                        {(scopeMode === "all" || scopeMode === "vector") && (
                          <div className="mt-3 border-t border-line-subtle pt-3">
                            <p className="mb-2 text-[11px] text-ink-subtle">
                              {t("personal.documents")}
                            </p>
                            {scopeMode === "vector" && vector.data?.degraded && (
                              <p className="mb-2 text-[11px] text-warning">
                                {t("personal.vectorDegraded", { reason: vector.data.reason ?? "" })}
                              </p>
                            )}
                            {documentHits.length ? (
                              <ul className="divide-y divide-line-subtle">
                                {documentHits.map((row) => (
                                  <li key={row.id} className="py-2">
                                    <p className="text-[--text-sm] font-medium text-ink">
                                      {row.title}
                                    </p>
                                    <p className="mt-0.5 text-[11px] text-ink-subtle">
                                      {row.database} / {row.collection}
                                    </p>
                                    <p className="mt-1 text-[--text-sm] text-ink-muted">
                                      {row.excerpt}
                                    </p>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-[11px] text-ink-subtle">
                                {t("personal.documentsEmpty")}
                              </p>
                            )}
                          </div>
                        )}
                      </>
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
                        <EventIdButton id={item.event_id} onClick={() => openEvent(item.event_id)} />
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
                {ontology.data.entities.filter((entity) => entity.type !== "session").slice(0, 16).map((entity) => (
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
                    <EventIdButton id={lead.event_id} onClick={() => openEvent(lead.event_id)} />
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
                <li key={week.period_key} className="bg-surface">
                  <button
                    type="button"
                    onClick={() => setWeekKey(week.period_key)}
                    className="w-full px-4 py-3 text-left hover:bg-surface-hover"
                  >
                    <p className="text-[11px] text-ink-subtle tnum">{week.period_key}</p>
                    <p className="mt-0.5 text-[--text-lg] font-semibold text-ink tnum">
                      {week.item_count}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={t("personal.empty")} />
          )}
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title={t("personal.traces")} description={t("personal.tracesDesc")}>
          {audit.data && (
            <div className="border-b border-line-subtle px-4 py-2">
              <StatusBadge tone={audit.data.verdict === "replay_ok" ? "success" : "danger"} dot>
                {audit.data.verdict === "replay_ok"
                  ? t("personal.auditOk", { n: audit.data.total })
                  : t("personal.auditBroken")}
              </StatusBadge>
            </div>
          )}
          {traces.isLoading ? (
            <Loading />
          ) : traces.isError ? (
            <ErrorState error={traces.error} onRetry={() => traces.refetch()} />
          ) : traces.data?.length ? (
            <ul className="divide-y divide-line-subtle">
              {traces.data.map((trace) => (
                <li key={trace.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                  <StatusBadge tone="neutral">{trace.kind}</StatusBadge>
                  {trace.target && (
                    <EventIdButton
                      id={trace.target}
                      onClick={() => openEvent(trace.target as string)}
                    />
                  )}
                  <span className="text-[11px] text-ink-subtle">{trace.actor}</span>
                  <span className="min-w-0 flex-1 truncate text-[11px] text-ink-subtle">
                    {trace.reason}
                  </span>
                  <span className="text-[11px] text-ink-subtle">
                    {trace.at.slice(0, 10)}
                  </span>
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
                  <span className="w-20 shrink-0">
                    <EventIdButton id={row.id} onClick={() => openEvent(row.id)} />
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

      <Modal
        open={!!eventId}
        onClose={() => setEventId(null)}
        title={t("personal.event")}
        width="max-w-2xl"
        footer={
          eventDetail.data &&
          ["ask", "answer", "reply", "note"].includes(eventDetail.data.kind) ? (
            action?.eventId === eventDetail.data.id ? (
              <div className="space-y-2">
                <TextArea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("personal.reasonPlaceholder")}
                  rows={2}
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="a-btn a-btn-ghost"
                    onClick={() => setAction(null)}
                  >
                    {t("personal.cancel")}
                  </button>
                  <button
                    type="button"
                    className="a-btn a-btn-primary"
                    disabled={!reason.trim() || act.isPending}
                    onClick={() =>
                      act.mutate({
                        kind: action.kind,
                        eventId: action.eventId,
                        reason,
                      })
                    }
                  >
                    {t("personal.confirm")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="a-btn a-btn-ghost"
                  onClick={() =>
                    setAction({ kind: "retract", eventId: eventDetail.data!.id })
                  }
                >
                  {t("personal.retract")}
                </button>
                <button
                  type="button"
                  className="a-btn a-btn-ghost"
                  onClick={() =>
                    setAction({ kind: "expiry", eventId: eventDetail.data!.id })
                  }
                >
                  {t("personal.expire")}
                </button>
              </div>
            )
          ) : undefined
        }
      >
        {eventDetail.isLoading ? (
          <Loading />
        ) : eventDetail.isError ? (
          <ErrorState error={eventDetail.error} />
        ) : eventDetail.data ? (
          <div className="space-y-3 px-4 pb-4">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-subtle">
              <span className="font-mono">{eventDetail.data.id}</span>
              <span>{eventDetail.data.actor}</span>
              <span>{eventDetail.data.occurred_at.slice(0, 10)}</span>
              <span>{eventDetail.data.kind}</span>
            </div>
            <p className="whitespace-pre-wrap text-[--text-sm] text-ink">
              {eventDetail.data.text}
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!weekKey}
        onClose={() => setWeekKey(null)}
        title={t("personal.periodDetail", { key: weekKey ?? "" })}
        width="max-w-2xl"
      >
        {weekDetail.isLoading ? (
          <Loading />
        ) : weekDetail.isError ? (
          <ErrorState error={weekDetail.error} />
        ) : weekDetail.data?.catalog.length ? (
          <div className="max-h-[60vh] overflow-y-auto px-4 pb-4">
            {weekDigest.data && (
              <div className="mb-3 rounded-[--radius-md] border border-line-subtle bg-surface-sunken p-3">
                <p className="text-[11px] text-ink-subtle">
                  {t("personal.digestCount", {
                    count: weekDigest.data.count,
                    days: weekDigest.data.days,
                  })}
                </p>
                <p className="mt-1 text-[--text-sm] text-ink">
                  {weekDigest.data.actors.map((actor) => `${actor.who} ${actor.n}`).join(" · ")}
                </p>
                {weekDigest.data.first_of_day.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {weekDigest.data.first_of_day.slice(-4).map((line) => (
                      <li key={line.event_id} className="text-[11px] text-ink-muted">
                        <span className="tnum">{line.date.slice(5)}</span>{" "}
                        <span className="text-ink-subtle">{line.actor}</span>{" "}
                        {line.text}
                      </li>
                    ))}
                  </ul>
                )}
                {weekDigest.data.decisions.length > 0 && (
                  <p className="mt-2 text-[11px] text-ink-subtle">
                    {t("personal.digestDecisions", {
                      n: weekDigest.data.decisions.length,
                    })}
                  </p>
                )}
              </div>
            )}
            <ul className="divide-y divide-line-subtle">
              {weekDetail.data.catalog.map((item) => (
                <li key={item.id} className="py-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-subtle">
                    <EventIdButton id={item.id} onClick={() => openEvent(item.id)} />
                    <span>{item.date}</span>
                    <span>{item.actor}</span>
                  </div>
                  <p className="mt-1 text-[--text-sm] text-ink">{item.first_line}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState title={t("personal.empty")} />
        )}
      </Modal>
    </div>
  );
}
