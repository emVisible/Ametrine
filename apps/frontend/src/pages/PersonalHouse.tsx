import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { personalAPI } from "../api/personal";
import { useI18n } from "../i18n/context";
import {
  Breadcrumbs,
  EmptyState,
  Loading,
  ErrorState,
  PageHeader,
  Panel,
  StatusBadge,
} from "../components/ui";

export default function PersonalHousePage() {
  const { t } = useI18n();
  const overview = useQuery({
    queryKey: ["personal", "house", "overview"],
    queryFn: personalAPI.houseOverview,
  });
  const persons = useQuery({
    queryKey: ["personal", "house", "persons"],
    queryFn: personalAPI.housePersons,
  });
  const rooms = useQuery({
    queryKey: ["personal", "house", "rooms"],
    queryFn: personalAPI.houseRooms,
  });

  return (
    <div className="flex flex-col gap-4">
      <Breadcrumbs items={[{ label: t("page.personal"), to: "/personal" },
                            { label: t("page.house") }]} />
      <PageHeader
        title={t("house.title")}
        description={t("house.desc")}
        actions={
          <Link to="/personal" className="a-btn a-btn-ghost">
            {t("house.back")}
          </Link>
        }
      />

      <Panel title={t("house.counts")}>
        {overview.isLoading ? (
          <Loading />
        ) : overview.isError ? (
          <ErrorState error={overview.error} onRetry={() => overview.refetch()} />
        ) : overview.data ? (
          <div className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-4">
            {Object.entries(overview.data.counts).map(([key, value]) => (
              <div key={key}>
                <p className="text-[11px] text-ink-subtle">{key}</p>
                <p className="text-[--text-lg] font-semibold text-ink tnum">{value}</p>
              </div>
            ))}
          </div>
        ) : null}
      </Panel>

      <Panel title={t("house.people")} description={t("house.peopleDesc")}>
        {persons.isLoading ? (
          <Loading />
        ) : persons.isError ? (
          <ErrorState error={persons.error} onRetry={() => persons.refetch()} />
        ) : persons.data?.length ? (
          <ul className="divide-y divide-line-subtle">
            {persons.data.map((person) => (
              <li key={person.who} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-ink">{person.who}</p>
                  <StatusBadge tone="neutral">
                    {t("house.crystals", { n: person.crystals.length })}
                  </StatusBadge>
                  <span className="text-[11px] text-ink-subtle">
                    {person.updated_at?.slice(0, 10)}
                  </span>
                </div>
                <p className="mt-1 text-[--text-sm] text-ink-muted">
                  {person.doing || person.confirmed || "—"}
                </p>
                {person.next && (
                  <p className="mt-1 text-[11px] text-ink-subtle">
                    {t("house.next")}: {person.next}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t("house.empty")} />
        )}
      </Panel>

      <Panel title={t("house.rooms")} description={t("house.roomsDesc")}>
        {rooms.isLoading ? (
          <Loading />
        ) : rooms.isError ? (
          <ErrorState error={rooms.error} onRetry={() => rooms.refetch()} />
        ) : rooms.data?.length ? (
          <ul className="divide-y divide-line-subtle">
            {rooms.data.map((room) => (
              <li key={room.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium text-ink">{room.topic}</p>
                  <StatusBadge tone={room.status === "ended" ? "neutral" : "accent"}>
                    {room.status}
                  </StatusBadge>
                  <span className="ml-auto text-[11px] text-ink-subtle tnum">
                    {room.turns} / {room.votes} / {room.presence}
                  </span>
                </div>
                {room.summary && (
                  <p className="mt-1 text-[11px] text-ink-subtle">{room.summary}</p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={t("house.empty")} />
        )}
      </Panel>
    </div>
  );
}
