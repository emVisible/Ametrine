import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { personalAPI } from "../api/personal";
import { useI18n } from "../i18n/context";
import {
  Breadcrumbs,
  EmptyState,
  ErrorState,
  Loading,
  PageHeader,
  Panel,
  StatusBadge,
} from "../components/ui";

function today(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

export default function PersonalDayPage() {
  const { t } = useI18n();
  const [date, setDate] = useState(today());
  const day = useQuery({
    queryKey: ["personal", "day", date],
    queryFn: () => personalAPI.day(date),
  });

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: t("page.personal"), to: "/personal" },
                            { label: t("page.day") }]} />
      <PageHeader
        title={t("day.title")}
        description={t("day.desc")}
        actions={
          <div className="flex items-center gap-2">
            <input
              type="date"
              className="a-input !w-auto"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              aria-label={t("day.date")}
            />
            <Link to="/personal" className="a-btn a-btn-ghost">
              {t("day.back")}
            </Link>
          </div>
        }
      />

      {day.isLoading ? (
        <Loading />
      ) : day.isError ? (
        <ErrorState error={day.error} onRetry={() => day.refetch()} />
      ) : day.data ? (
        <>
          {day.data.exists ? (
            <>
              <div className="grid gap-3 sm:grid-cols-5">
                {day.data.segments.map((segment) => (
                  <Panel key={segment.key} bodyClass="p-3">
                    <div className="flex items-center gap-2">
                      <p className="text-[--text-sm] font-medium text-ink">
                        {segment.label}
                      </p>
                      {segment.current && (
                        <StatusBadge tone="accent">{t("day.now")}</StatusBadge>
                      )}
                    </div>
                    <p className="mt-1 text-[11px] text-ink-subtle tnum">
                      {t("day.items", { n: segment.count })}
                    </p>
                    <ul className="mt-2 space-y-2">
                      {segment.items.map((item) => (
                        <li key={item.event_id} className="text-[11px] text-ink-muted">
                          <span className="tnum">{item.at}</span>{" "}
                          <span className="text-ink-subtle">{item.actor}</span>
                          <p className="mt-0.5 line-clamp-3">{item.text}</p>
                        </li>
                      ))}
                    </ul>
                  </Panel>
                ))}
              </div>

              {(day.data.cards.length > 0 || day.data.crystals.length > 0) && (
                <Panel title={t("day.keeps")}>
                  <div className="space-y-3 px-4 py-3">
                    {day.data.cards.map((card) => (
                      <div key={`card-${card.id}`}>
                        <p className="text-[--text-sm] text-ink">{card.summary}</p>
                        <p className="text-[11px] text-ink-subtle">
                          {card.who} · {card.feeling}
                        </p>
                      </div>
                    ))}
                    {day.data.crystals.map((crystal) => (
                      <div key={`crystal-${crystal.id}`}>
                        <p className="text-[--text-sm] text-ink">{crystal.content}</p>
                        <p className="text-[11px] text-ink-subtle">
                          {crystal.who} · {crystal.kind}
                        </p>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}

              <Panel title={t("day.notes")}>
                <ul className="list-disc space-y-1 px-8 py-3 text-[11px] text-ink-subtle">
                  {day.data.notes.map((note) => <li key={note}>{note}</li>)}
                </ul>
              </Panel>
            </>
          ) : (
            <Panel>
              <EmptyState title={t("day.empty")} />
            </Panel>
          )}
        </>
      ) : null}
    </div>
  );
}
