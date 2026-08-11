import { cn } from "@/lib/utils";

const STATUSES: Record<string, { label: string; className: string }> = {
  paid: { label: "Confirmed", className: "bg-paid-tint text-paid" },
  pending: { label: "Awaiting payment", className: "bg-amber-tint text-amber" },
  refunded: { label: "Refunded", className: "bg-muted text-muted-foreground" },
  cancelled: { label: "Cancelled", className: "bg-destructive-tint text-destructive" },
  expired: { label: "Expired", className: "bg-muted text-muted-foreground" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUSES[status];
  return (
    <span
      className={cn(
        "shrink-0 rounded-pill px-2.5 py-1 text-[12px] font-semibold",
        s?.className ?? "bg-muted text-muted-foreground",
      )}
    >
      {s?.label ?? status}
    </span>
  );
}
