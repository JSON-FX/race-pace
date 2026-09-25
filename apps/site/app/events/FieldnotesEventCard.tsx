import Link from "next/link";
import Image from "next/image";
import { formatDateRange, formatAddress } from "@race-pace/shared";
import { shortDate } from "@/lib/format";
import { eventPublicPath, type EventRow } from "@/lib/events";
import { eventState, STATE_BADGE } from "@/lib/eventState";
import { FieldnotesHero } from "./FieldnotesHero";

/** Fieldnotes catalog card, scoped to the runner event discovery pilot. */
export function FieldnotesEventCard({ event }: { event: EventRow }) {
  const date = event.event_date ? formatDateRange(event.event_date, event.end_date, shortDate) : null;
  const location = formatAddress({ city_name: event.city_name, province_name: event.province_name });
  const state = eventState(event);
  const badge = state === "open" ? null : STATE_BADGE[state];
  const organizerInitials = event.org_name?.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();

  return (
    <Link
      href={eventPublicPath(event)}
      className="fieldnotes-race-card"
    >
      <div className="fieldnotes-race-card__media">
        <FieldnotesHero src={event.hero_image_url} />

        {event.org_name ? (
          <span className="fieldnotes-race-card__avatar" aria-hidden="true">
            {event.org_logo_url ? (
              <Image src={event.org_logo_url} alt="" width={48} height={48} className="fieldnotes-race-card__avatar-image" />
            ) : organizerInitials}
          </span>
        ) : null}

        {/* Derived, not raw status: "Ongoing" and "Rescheduled" are not enum
            values, so reading `event.status` here showed a race that is
            happening right now as "Closed". See lib/eventState.ts. */}
        {badge ? (
          <span className="fieldnotes-race-card__status" data-state={state}>
            {badge.label}
          </span>
        ) : null}
      </div>

      <div className="fieldnotes-race-card__body">
        {event.org_name ? (
          <div className="fieldnotes-race-card__organizer">
            <span className="fieldnotes-race-card__organizer-name">{event.org_name}</span>
          </div>
        ) : null}
        <h3 className="fieldnotes-race-card__title">
          {event.name}
        </h3>

        <div className="fieldnotes-race-card__meta">
          {date ? <span>{date}</span> : null}
          {location ? <span>{location}</span> : null}
        </div>
        {event.slots_left != null ? (
          <p className="fieldnotes-race-card__slots" data-empty={event.slots_left === 0}>
            <strong>{event.slots_left.toLocaleString("en-PH")}</strong> {event.slots_left === 1 ? "slot" : "slots"} left
          </p>
        ) : null}

        <div className="fieldnotes-race-card__footer">
          {event.distances.map((d) => (
            <span
              key={d}
              className="fieldnotes-race-card__distance"
            >
              {d}K
            </span>
          ))}
        </div>
        <span className="fieldnotes-race-card__view">View race <span aria-hidden="true">↗</span></span>
      </div>
    </Link>
  );
}
