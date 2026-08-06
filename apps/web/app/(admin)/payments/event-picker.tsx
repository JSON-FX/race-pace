"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { EventCombobox } from "@/components/EventCombobox";
import { ALL_EVENTS } from "./constants";

/**
 * Scope the Payments page to one event, or to the whole organization.
 *
 * A searchable combobox rather than the plain <Select> the Status and Method
 * filters use: those have four fixed options, while this list grows with every
 * race an organizer has ever run.
 *
 * "All events" is a real entry in the list rather than a separate clear button —
 * it is the default state, so it needs to be reachable in one action from
 * anywhere in a long list.
 */
export function PaymentsEventPicker({ events, value }: {
  events: { id: string; name: string; count: number }[];
  value: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const options = [
    { id: ALL_EVENTS, name: "All events", subtitle: `${events.length} events` },
    ...events.map((e) => ({
      id: e.id,
      name: e.name,
      subtitle: `${e.count} registration${e.count === 1 ? "" : "s"}`,
    })),
  ];

  return (
    <EventCombobox
      events={options}
      value={value}
      label="Filter payments by event"
      className="w-[240px]"
      placeholder="All events"
      onSelect={(id) => {
        // Preserve status/method/search, drop pagination: page 4 of the whole
        // org is rarely page 4 of one event, and landing on an empty page reads
        // as "this event has no payments".
        const next = new URLSearchParams(search.toString());
        if (id === ALL_EVENTS) next.delete("event");
        else next.set("event", id);
        next.delete("page");
        const qs = next.toString();
        router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }}
    />
  );
}
