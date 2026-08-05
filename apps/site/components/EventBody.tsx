import Image from "next/image";
import { disciplineLayout } from "@race-pace/shared";
import type { EventRow, CategoryRow } from "@/lib/events";
import { ProfileCourseSection } from "@/components/discipline/ProfileCourseSection";
import { RouteSignatureSection } from "@/components/discipline/RouteSection";
import { RouteDistances } from "@/components/discipline/RouteDistances";
import { RaceFacts } from "@/components/discipline/RaceFacts";
import { RaceSchedule } from "@/components/discipline/RaceSchedule";
import { InclusionsBand } from "@/components/discipline/InclusionsBand";

/**
 * Everything below the hero, shared by the single-event poster
 * (SingleEventLanding) and the multi-event detail page (app/events/[id]) —
 * both need the exact same discipline-branched body, and duplicating it
 * would be exactly the kind of drift disciplineLayout() exists to prevent.
 *
 * Call `disciplineLayout()` — never branch on `discipline === "trail"`
 * directly. There are eight disciplines and only two layouts; hardcoding
 * one discipline name would silently exclude ultra/cross_country/obstacle
 * (or road/marathon/half_marathon for the other branch).
 */
export function EventBody({ event, categories, closed }: { event: EventRow; categories: CategoryRow[]; closed: boolean }) {
  const layout = disciplineLayout(event.discipline);
  const schedule = event.schedule ?? [];

  return (
    <>
      <div className="mx-auto w-full max-w-5xl px-6 py-16">
        {event.status_note ? (
          <p className="mb-12 rounded-xl border border-amber bg-amber-tint px-5 py-4 text-[15px] text-foreground">
            {event.status_note}
          </p>
        ) : null}

        {event.description ? (
          <p className="max-w-2xl text-[19px] leading-relaxed text-foreground">{event.description}</p>
        ) : null}
      </div>

      {layout === "profile" ? (
        <>
          <ProfileCourseSection event={event} categories={categories} closed={closed} />
          <RaceFacts event={event} />
          <InclusionsBand event={event} />
        </>
      ) : (
        <>
          <RouteSignatureSection event={event} categories={categories} />
          <RouteDistances categories={categories} closed={closed} />
          <InclusionsBand event={event} />
          <RaceSchedule schedule={schedule} />
        </>
      )}

      {event.org_name ? (
        <div className="mx-auto flex w-full max-w-5xl items-center gap-4 px-6 py-16">
          {event.org_logo_url ? (
            <Image
              src={event.org_logo_url}
              alt=""
              width={52}
              height={52}
              className="h-[52px] w-[52px] shrink-0 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full bg-forest text-[15px] font-bold text-white">
              {event.org_name.slice(0, 1)}
            </div>
          )}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[1.2px] text-muted-foreground">Organized by</p>
            <p className="mt-0.5 font-display text-[19px] font-extrabold text-foreground">{event.org_name}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
