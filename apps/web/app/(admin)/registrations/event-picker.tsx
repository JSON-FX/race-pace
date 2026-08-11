"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useReportPending } from "@/components/NavProgress";

export function EventPicker({ events, value }: {
  events: { id: string; name: string; count: number }[];
  value: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // Without a transition this push was completely silent: the browser holds the
  // OLD page until the server responds, so switching events read as a click
  // that never landed. `isPending` drives both the shared top bar and the
  // trigger's own busy state below.
  const [isPending, startTransition] = useTransition();
  useReportPending(isPending);

  return (
    <Select
      value={value}
      onValueChange={(id) => {
        // Category ids are per-event, so carrying a category filter across a
        // switch would silently return zero rows. Drop every other param and
        // start clean on the new event.
        startTransition(() => {
          router.push(`${pathname}?event=${id}`, { scroll: false });
        });
      }}
    >
      <SelectTrigger
        aria-label="Event"
        // Named on the trigger rather than announced via a live region: this
        // is the control the operator just acted on, so the busy state belongs
        // where their attention already is.
        aria-busy={isPending}
        className="h-9 w-[280px] rounded-lg data-[busy=true]:opacity-70"
        data-busy={isPending}
      >
        <SelectValue placeholder="Pick an event" />
      </SelectTrigger>
      <SelectContent>
        {events.map((e) => (
          <SelectItem key={e.id} value={e.id}>
            {e.name} <span className="tabular text-muted-foreground">({e.count})</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
