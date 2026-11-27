import { useState } from "react";
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
  SearchInput,
  StatusBadge,
  TextInput,
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
  const [eventQuery, setEventQuery] = useState("");
  const [eventActor, setEventActor] = useState("");
  const [eventOffset, setEventOffset] = useState(0);
  const events = useQuery({
    queryKey: ["personal", "house", "events", eventQuery, eventActor, eventOffset],
    queryFn: () => personalAPI.houseEvents(eventQuery, eventActor, 50, eventOffset),
  });
  const totalEvents = events.data?.total ?? 0;

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
                    {t("house.nextPage")}: {person.next}
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

      <Panel title={t("house.events")} description={t("house.eventsDesc")}>
        <div className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_14rem]">
          <SearchInput
            value={eventQuery}
            onValueChange={(value) => {
              setEventQuery(value);
              setEventOffset(0);
            }}
            placeholder={t("house.searchEvents")}
          />
          <TextInput
            value={eventActor}
            onChange={(e) => {
              setEventActor(e.target.value);
              setEventOffset(0);
            }}
            placeholder={t("house.actorFilter")}
            aria-label={t("house.actorFilter")}
          />
        </div>
        {events.isLoading ? (
          <Loading />
        ) : events.isError ? (
          <ErrorState error={events.error} onRetry={() => events.refetch()} />
        ) : events.data?.items.length ? (
          <>
            <ul className="divide-y divide-line-subtle">
              {events.data.items.map((event) => (
                <li key={event.seq} className="px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-subtle">
                    <span className="font-mono tnum">#{event.seq}</span>
                    <span>{event.occurred_at.slice(0, 10)}</span>
                    <span>{event.actor}</span>
                    <StatusBadge tone="neutral">{event.kind}</StatusBadge>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-[--text-sm] text-ink">
                    {event.text}
                  </p>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between border-t border-line-subtle px-4 py-2">
              <p className="text-[11px] text-ink-subtle tnum">
                {t("house.eventRange", {
                  from: eventOffset + 1,
                  to: Math.min(eventOffset + 50, totalEvents),
                  total: totalEvents,
                })}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="a-btn a-btn-ghost"
                  disabled={eventOffset === 0}
                  onClick={() => setEventOffset(Math.max(0, eventOffset - 50))}
                >
                  {t("house.prevPage")}
                </button>
                <button
                  type="button"
                  className="a-btn a-btn-ghost"
                  disabled={eventOffset + 50 >= totalEvents}
                  onClick={() => setEventOffset(eventOffset + 50)}
                >
                  {t("house.nextPage")}
                </button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState title={t("house.empty")} />
        )}
      </Panel>
    </div>
  );
}
