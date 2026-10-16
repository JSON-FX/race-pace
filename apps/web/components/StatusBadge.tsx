import { Status } from "@race-pace/ui";
import type { RegistrationRow } from "@/lib/queries/registrations";

export type BadgeTone = "paid" | "pending" | "info" | "danger" | "neutral" | "highlight";

const tones = { paid: "success", pending: "warning", info: "info", danger: "danger", neutral: "neutral", highlight: "neutral" } as const;

export function StatusBadge({ tone, children, className }: { tone: BadgeTone; children: React.ReactNode; className?: string }) {
  return <Status tone={tones[tone]} dot={false} className={className}>{children}</Status>;
}

const PAYMENT: Record<string, { label: string; tone: BadgeTone }> = {
  paid: { label: "Paid", tone: "paid" },
  pending: { label: "Pending", tone: "pending" },
  refunded: { label: "Refunded", tone: "info" },
  partially_refunded: { label: "Partially refunded", tone: "info" },
  failed: { label: "Failed", tone: "danger" },
};

export function PaymentStatusBadge({ status }: { status: string | null }) {
  const s = PAYMENT[status ?? ""] ?? { label: status ?? "—", tone: "neutral" as const };
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}

/** Receipt progress is separate from the settled payment ledger. */
export function RegistrationPaymentStatusBadge({ row }: { row: Pick<RegistrationRow, "payment_progress" | "payment_progress_unavailable" | "payment_status" | "registration_status"> }) {
  if (row.payment_progress?.state === "processing") return <StatusBadge tone="info">Payment received · processing</StatusBadge>;
  if (row.payment_progress?.state === "review_required") return <StatusBadge tone="danger">Payment needs review</StatusBadge>;
  if (row.payment_progress_unavailable && !["paid", "refunded", "partially_refunded"].includes(row.payment_status ?? "")) {
    return <StatusBadge tone="neutral">Payment status unavailable</StatusBadge>;
  }
  if (row.registration_status === "expired" || row.registration_status === "cancelled") return <RegistrationStatusBadge status={row.registration_status} />;
  return <PaymentStatusBadge status={row.payment_status} />;
}

// registrations.status, distinct from payment_status above (see
// RegistrationStatus's doc comment in lib/queries/registrations.ts). Only
// rendered in place of PaymentStatusBadge for 'expired'/'cancelled' — the two
// values that can't be told apart on the payment_status enum at all.
//
// Tones deliberately differ, mirroring EVENT's cancelled/closed split below:
//   - expired: neutral — a passive, common, non-alarming fact (a 24h hold ran
//     out, or the event closed on a runner who hadn't paid yet). A roster
//     where every abandoned checkout lights up red would bury the rows that
//     actually need attention.
//   - cancelled: danger — a deliberate action, a runner withdrew or an admin
//     intervened, same treatment EVENT already gives 'cancelled' below.
const REGISTRATION: Record<string, { label: string; tone: BadgeTone }> = {
  expired: { label: "Expired", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "danger" },
  pending: { label: "Pending", tone: "pending" },
  paid: { label: "Paid", tone: "paid" },
  refunded: { label: "Refunded", tone: "info" },
};

export function RegistrationStatusBadge({ status }: { status: string | null }) {
  const s = REGISTRATION[status ?? ""] ?? { label: status ?? "—", tone: "neutral" as const };
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}

const EVENT: Record<string, { label: string; tone: BadgeTone }> = {
  coming_soon: { label: "Coming soon", tone: "info" },
  open: { label: "Open", tone: "highlight" },
  almost_full: { label: "Almost full", tone: "pending" },
  cancelled: { label: "Cancelled", tone: "danger" },
  rescheduled: { label: "Rescheduled", tone: "info" },
  completed: { label: "Completed", tone: "neutral" },
  closed: { label: "Closed", tone: "neutral" },
  draft: { label: "Draft", tone: "neutral" },
};

export function EventStatusBadge({ status }: { status: string }) {
  const s = EVENT[status] ?? { label: status.replace(/_/g, " "), tone: "neutral" as const };
  return <StatusBadge tone={s.tone} className="capitalize">{s.label}</StatusBadge>;
}
