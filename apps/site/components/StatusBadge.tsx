import { Status } from "@race-pace/ui";

const statuses = {
  paid: { label: "Confirmed", tone: "success" },
  pending: { label: "Awaiting payment", tone: "warning" },
  refunded: { label: "Refunded", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
} as const;

export function StatusBadge({ status }: { status: string }) {
  const entry = statuses[status as keyof typeof statuses];
  return <Status tone={entry?.tone ?? "neutral"}>{entry?.label ?? status}</Status>;
}
