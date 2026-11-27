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
  SearchInput,
  StatusBadge,
  TextInput,
} from "../components/ui";

const PAGE = 50;

export default function PersonalArchivePage() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [actor, setActor] = useState("");
  const [offset, setOffset] = useState(0);
  const archive = useQuery({
    queryKey: ["personal", "archive", q, actor, offset],
    queryFn: () => personalAPI.archive(q, actor, PAGE, offset),
  });

  const reset = (fn: () => void) => {
    fn();
    setOffset(0);
  };
  const total = archive.data?.total ?? 0;
  const canPrev = offset > 0;
  const canNext = offset + PAGE < total;

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: t("page.personal"), to: "/personal" },
                            { label: t("page.archive") }]} />
      <PageHeader
        title={t("archive.title")}
        description={t("archive.desc", { total })}
        actions={
          <Link to="/personal" className="a-btn a-btn-ghost">
            {t("archive.back")}
          </Link>
        }
      />

      <Panel bodyClass="p-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
          <SearchInput
            value={q}
            onValueChange={(value) => reset(() => setQ(value))}
            placeholder={t("archive.searchPlaceholder")}
          />
          <TextInput
            value={actor}
            onChange={(e) => reset(() => setActor(e.target.value))}
            placeholder={t("archive.actorPlaceholder")}
            aria-label={t("archive.actor")}
          />
        </div>
      </Panel>

      <Panel bodyClass="p-0">
        {archive.isLoading ? (
          <Loading />
        ) : archive.isError ? (
          <ErrorState error={archive.error} onRetry={() => archive.refetch()} />
        ) : archive.data?.items.length ? (
          <>
            <ul className="divide-y divide-line-subtle">
              {archive.data.items.map((row) => (
                <li key={row.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-subtle">
                    <span className="font-mono">{row.id}</span>
                    <span>{row.occurred_at.slice(0, 10)}</span>
                    <span>{row.actor}</span>
                    <StatusBadge tone="neutral">{row.kind}</StatusBadge>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[--text-sm] text-ink">
                    {row.text}
                  </p>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-line-subtle px-4 py-2">
              <p className="text-[11px] text-ink-subtle tnum">
                {t("archive.range", {
                  from: offset + 1,
                  to: Math.min(offset + PAGE, total),
                  total,
                })}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="a-btn a-btn-ghost"
                  disabled={!canPrev}
                  onClick={() => setOffset(Math.max(0, offset - PAGE))}
                >
                  {t("archive.prev")}
                </button>
                <button
                  type="button"
                  className="a-btn a-btn-ghost"
                  disabled={!canNext}
                  onClick={() => setOffset(offset + PAGE)}
                >
                  {t("archive.next")}
                </button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState title={t("archive.empty")} />
        )}
      </Panel>
    </div>
  );
}
