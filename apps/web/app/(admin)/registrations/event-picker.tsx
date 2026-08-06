"use client";

import { usePathname, useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function EventPicker({ events, value }: {
  events: { id: string; name: string; count: number }[];
  value: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <Select
      value={value}
      onValueChange={(id) => {
        // Category ids are per-event, so carrying a category filter across a
        // switch would silently return zero rows. Drop every other param and
        // start clean on the new event.
        router.push(`${pathname}?event=${id}`, { scroll: false });
      }}
    >
      <SelectTrigger aria-label="Event" className="h-9 w-[280px] rounded-lg">
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
