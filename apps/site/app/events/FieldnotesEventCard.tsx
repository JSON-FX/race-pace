import Link from "next/link";
import { formatDateRange, formatAddress } from "@race-pace/shared";
import { shortDate } from "@/lib/format";
import { eventPublicPath, type EventRow } from "@/lib/events";
import { eventState, STATE_BADGE } from "@/lib/eventState";
import { FieldnotesHero } from "./FieldnotesHero";

/** Fieldnotes catalog card, scoped to the runner event discovery pilot. */
export function FieldnotesEventCard({ event, index }: { event: EventRow; index?: number }) {
  const date = event.event_date ? formatDateRange(event.event_date, event.end_date, shortDate) : null;
  const location = formatAddress({ city_name: event.city_name, province_name: event.province_name });
  const state = eventState(event);
  const badge = state === "open" ? null : STATE_BADGE[state];

  return (
    <Link
      href={eventPublicPath(event)}
      className="fieldnotes-race-card"
    >
      <div className="fieldnotes-race-card__media">
        <FieldnotesHero src={event.hero_image_url} />

        {index != null ? (
          <span className="fieldnotes-race-card__number">
            {String(index).padStart(2, "0")}
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
          <p className="fieldnotes-race-card__organizer">
            {event.org_name}
          </p>
        ) : null}
        <h3 className="fieldnotes-race-card__title">
          {event.name}
        </h3>

        <div className="fieldnotes-race-card__meta">
          {date ? <span>{date}</span> : null}
          {location ? <span>{location}</span> : null}
        </div>

        {event.distances.length > 0 ? (
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
        ) : null}
        <span className="fieldnotes-race-card__view">View race <span aria-hidden="true">↗</span></span>
      </div>
    </Link>
  );
}
