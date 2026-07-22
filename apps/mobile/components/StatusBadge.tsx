import { View } from "react-native";
import type { EventRow } from "../lib/events";
import { longDate } from "../lib/format";
import { Badge } from "@/components/ui/badge";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";

export type StatusKind = "open" | "almost_full" | "closed" | "completed" | "cancelled" | "rescheduled";

export function eventStatusKind(e: Pick<EventRow, "status" | "original_date">): StatusKind {
  if (e.status === "cancelled") return "cancelled";
  if (e.original_date) return "rescheduled";
  return (["almost_full", "closed", "completed"].includes(e.status) ? e.status : "open") as StatusKind;
}
const LABEL: Record<StatusKind, string> = {
  open: "Open", almost_full: "Almost full", closed: "Closed", completed: "Completed", cancelled: "Cancelled", rescheduled: "Rescheduled",
};
export function eventStatusLabel(e: Pick<EventRow, "status" | "original_date">) { return LABEL[eventStatusKind(e)]; }

export function StatusBadge({ event }: { event: Pick<EventRow, "status" | "original_date"> }) {
  return (
    <Badge variant={eventStatusKind(event)} className="self-start">
      <Text>{eventStatusLabel(event)}</Text>
    </Badge>
  );
}

export function StatusBanner({ event }: { event: Pick<EventRow, "status" | "original_date" | "event_date" | "status_note"> }) {
  const kind = eventStatusKind(event);
  if (kind !== "cancelled" && kind !== "rescheduled") return null;
  const cancelled = kind === "cancelled";
  return (
    <View className={cn("px-[18px] py-[13px]", cancelled ? "bg-destructive-tint" : "bg-info-tint")}>
      <View className="flex-row items-start gap-[10px]">
        <Text className={cn("text-[15px] leading-5", cancelled ? "text-destructive" : "text-info")}>{cancelled ? "⊘" : "↻"}</Text>
        <Text className={cn("flex-1 text-sm font-semibold leading-5", cancelled ? "text-destructive" : "text-info")}>
          {cancelled ? "This event was cancelled" : `Rescheduled — new date ${longDate(event.event_date)}`}
        </Text>
      </View>
      {!cancelled && event.original_date ? (
        <Text className="ml-[25px] mt-[3px] text-xs text-info/80">was {longDate(event.original_date)}</Text>
      ) : null}
      {cancelled && event.status_note ? (
        <Text className="ml-[25px] mt-[3px] text-xs text-muted-foreground">{event.status_note}</Text>
      ) : null}
    </View>
  );
}
