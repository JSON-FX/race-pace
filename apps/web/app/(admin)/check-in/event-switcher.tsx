"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { EventCombobox } from "@/components/EventCombobox";

/**
 * Event picker for the check-in page.
 *
 * PROGRESSIVE ENHANCEMENT, deliberately. The original picker was a plain
 * `<form method="get">` with a native <select>, for a good reason recorded in
 * page.tsx: switching event is a navigation, so it works before hydration —
 * "which on a start-line phone on 3G is a real window, not a theoretical one".
 *
 * A searchable combobox is a Client Component and cannot keep that property. So
 * rather than trade one real failure for another, this renders the plain form
 * first — which is also what the server sends — and swaps in the combobox only
 * once mounted. A marshal on a cold 3G connection still gets a working (if
 * scrolly) picker; everyone past hydration gets search.
 *
 * The two paths navigate identically (`?event=<id>`), so a switch mid-hydration
 * cannot land somewhere different from where the operator aimed.
 */
export function EventSwitcher({
  events, value,
}: {
  events: { id: string; name: string; subtitle?: string | null }[];
  value: string;
}) {
  const router = useRouter();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <form method="get" className="flex items-center gap-1.5">
        <label htmlFor="event" className="sr-only">Switch event</label>
        <select
          id="event"
          name="event"
          defaultValue={value}
          className="rounded-lg border bg-card px-2.5 py-[5px] text-[12.5px] font-semibold"
        >
          {events.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
        <button
          type="submit"
          className="cursor-pointer rounded-lg border bg-card px-2.5 py-[5px] text-[12.5px] font-semibold hover:bg-muted"
        >
          Switch
        </button>
      </form>
    );
  }

  return (
    <EventCombobox
      events={events}
      value={value}
      label="Switch event"
      className="w-[260px]"
      onSelect={(id) => {
        // Same target the no-JS form posts to, so the two paths cannot diverge.
        router.push(`?event=${id}`, { scroll: false });
      }}
    />
  );
}
