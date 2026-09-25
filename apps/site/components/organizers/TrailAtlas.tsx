import Link from "next/link";
import { eventPublicPath } from "@/lib/events";
import { shortDate } from "@/lib/format";
import type { Organizer, OrganizerEvent } from "@/lib/organizers";
import { OrganizerMark, OrganizerPhoto } from "./OrganizerMedia";

export function OrganizerDirectoryRow({ organizer }: { organizer: Organizer }) {
  const next = organizer.events[0];
  return (
    <article className="trail-atlas__org-row">
      <OrganizerPhoto src={organizer.bannerUrl ?? next?.imageUrl ?? null} className="trail-atlas__row-photo" />
      <div className="trail-atlas__org-copy">
        <div className="trail-atlas__row-meta">
          {[organizer.homeRegion, `${organizer.events.length} upcoming ${organizer.events.length === 1 ? "event" : "events"}`].filter(Boolean).join(" · ")}
        </div>
        <h2>{organizer.name}</h2>
        {organizer.description ? <p>{organizer.description}</p> : null}
        {next ? <span className="trail-atlas__next">Next: {next.name} · {shortDate(next.eventDate)}</span> : null}
      </div>
      <Link className="trail-atlas__action trail-atlas__action--secondary" href={`/organizers/${encodeURIComponent(organizer.slug)}`} aria-label={`View ${organizer.name} profile`}>
        View profile
      </Link>
    </article>
  );
}

export function OrganizerProfileOpenSpread({ organizer }: { organizer: Organizer }) {
  return (
    <section className={`trail-atlas__profile-hero${organizer.featuredImageUrl ? "" : " trail-atlas__profile-hero--text-only"}`} aria-labelledby="organizer-name">
      {organizer.featuredImageUrl ? <OrganizerPhoto src={organizer.featuredImageUrl} className="trail-atlas__hero-photo" /> : null}
      <div className="trail-atlas__profile-summary">
        <OrganizerMark organizer={organizer} large />
        <h1 id="organizer-name">{organizer.name}</h1>
        {organizer.description ? <p>{organizer.description}</p> : null}
        <div className="trail-atlas__hero-facts">
          <span>{organizer.events.length} upcoming {organizer.events.length === 1 ? "event" : "events"}</span>
          {organizer.homeBase ? <span>{organizer.homeBase}</span> : null}
        </div>
      </div>
    </section>
  );
}

function availabilityOf(event: OrganizerEvent): string | null {
  if (event.registrationClosed) return "Registration closed";
  if (event.slotsLeft === 0) return "Sold out";
  if (event.slotsLeft != null) return `${event.slotsLeft.toLocaleString("en-PH")} ${event.slotsLeft === 1 ? "slot" : "slots"} left`;
  return null;
}

export function OrganizerEventRow({ event }: { event: OrganizerEvent }) {
  const detail = [event.place, event.distances.map((distance) => `${distance}K`).join(" · ")].filter(Boolean).join(" · ");
  return (
    <Link href={eventPublicPath(event)} className="trail-atlas__event-row">
      <OrganizerPhoto src={event.imageUrl} className="trail-atlas__event-photo" />
      <div className="trail-atlas__event-copy">
        <h3>{event.name}</h3>
        {detail ? <p>{detail}</p> : null}
        {availabilityOf(event) ? <span className="trail-atlas__availability">{availabilityOf(event)}</span> : null}
      </div>
      <time dateTime={event.eventDate} className="trail-atlas__event-date">{shortDate(event.eventDate)}</time>
    </Link>
  );
}
