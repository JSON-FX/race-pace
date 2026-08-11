import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

export type BadgeTone = "paid" | "pending" | "info" | "danger" | "neutral" | "highlight";

const tone = cva(
  "inline-flex items-center gap-[5px] rounded-pill px-2.5 py-1 text-[11px] font-semibold",
  {
    variants: {
      tone: {
        paid: "bg-paid-tint text-forest dark:text-paid",
        pending: "bg-amber-tint text-amber",
        info: "bg-info-tint text-info",
        danger: "bg-destructive-tint text-destructive",
        neutral: "bg-muted text-muted-foreground",
        highlight: "bg-muted text-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  }
);

/** The mockup's `.bdg` dot badge: a 5px leading dot in `currentColor`, so it
 *  always matches whatever tone color the badge itself resolves to without a
 *  second color prop to keep in sync. */
export function StatusBadge({ tone: t, children, className }: { tone: BadgeTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn(tone({ tone: t }), className)}>
      <span aria-hidden="true" className="size-[5px] shrink-0 rounded-full bg-current" />
      {children}
    </span>
  );
}

const PAYMENT: Record<string, { label: string; tone: BadgeTone }> = {
  paid: { label: "Paid", tone: "paid" },
  pending: { label: "Pending", tone: "pending" },
  refunded: { label: "Refunded", tone: "info" },
  failed: { label: "Failed", tone: "danger" },
};

export function PaymentStatusBadge({ status }: { status: string | null }) {
  const s = PAYMENT[status ?? ""] ?? { label: status ?? "—", tone: "neutral" as const };
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
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
