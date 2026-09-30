"use client";


import { Badge } from "@/components/ui/badge";
import { useRef, useState } from "react";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PhotoAvatar } from "@/components/PhotoAvatar";
import { Button } from "@/components/ui/button";
import { peso, fmtDateTime, initials } from "@/lib/format";
import { fieldLabel, fieldValue } from "@/lib/field-labels";
import { cn } from "@/lib/utils";
import type { RegistrationRow } from "@/lib/queries/registrations";
import { registrationTeamName } from "@/lib/registration-team";
import { PaymentStatusBadge, RegistrationStatusBadge } from "./StatusBadge";
import { BulkCancelDialog } from "./BulkCancelDialog";
import { MethodBadge } from "./MethodBadge";
import { RefundModal } from "./RefundModal";
import { CopyButton } from "./CopyButton";
import { avatarTint } from "./RunnerAvatar";
import { RegistrationHistory } from "./RegistrationHistory";
import "./registration-detail.css";

/**
 * What the money band says, per payment status.
 *
 * The band is tinted, but the tint is never the only signal — the eyebrow
 * states the status in words and the header carries a PaymentStatusBadge with
 * its own label (§1 color-not-only). An organizer who can't distinguish the
 * green tint from the amber one still reads "Total paid" vs "Awaiting payment".
 */
const MONEY: Record<string, { eyebrow: string; band: string; ink: string }> = {
  paid: { eyebrow: "Total paid", band: "bg-paid-tint", ink: "text-forest dark:text-paid" },
  pending: { eyebrow: "Awaiting payment", band: "bg-amber-tint", ink: "text-amber" },
  partially_refunded: { eyebrow: "Total paid before refund", band: "bg-info-tint", ink: "text-info" },
  refunded: { eyebrow: "Refunded", band: "bg-info-tint", ink: "text-info" },
  failed: { eyebrow: "Payment failed", band: "bg-destructive-tint", ink: "text-destructive" },
};
const MONEY_FALLBACK = { eyebrow: "Amount", band: "bg-muted", ink: "text-foreground" };

/** Why the refund button is in the state it's in. A disabled control with no
 *  stated reason is the anti-pattern this replaces — the old modal greyed the
 *  button out and left the organizer to infer why. */
const REFUND_REASON: Record<string, string> = {
  paid: "A full refund releases the slot. A partial refund keeps the ticket and slot active.",
  partially_refunded: "This payment has already been partially refunded. Its ticket and slot remain active.",
  pending: "Only a completed payment can be refunded.",
  refunded: "Already refunded — the slot went back on sale.",
  failed: "This payment never completed, so there's nothing to return.",
};

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return <div className="registration-detail-field">
    <dt>{label}</dt><dd className={mono ? "tabular-nums" : undefined}>{value}</dd>
  </div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="registration-detail-section" aria-label={title}>
    <h3>{title}</h3><dl>{children}</dl>
  </section>;
}

export function RegistrationDetail({ row, onClose, onRefunded }: {
  row: RegistrationRow; onClose: () => void; onRefunded: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [refunding, setRefunding] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const complimentary = row.total_amount === 0 && (row.discount_amount_cents ?? 0) > 0;
  const canRefund = row.payment_status === "paid";
  const customEntries = Object.entries(row.custom_data ?? {}).filter(([key]) => key !== "team_name" && key !== "bib_name");
  const teamName = registrationTeamName(row.custom_data);
  const money = MONEY[row.payment_status ?? ""] ?? MONEY_FALLBACK;
  const tint = avatarTint(row.id);
  const captured = row.payment_status === "paid" || row.payment_status === "partially_refunded";
  const displayedAmount = row.payment_status === "refunded" ? row.refunded_amount
    : captured ? row.payment_amount : row.total_amount;

  /**
   * The entry fee, derived rather than read.
   *
   * `registrations-checkout` builds the charge as
   * `total_amount = category.base_price + Σ add-on prices`, and
   * `registration_addons.price` snapshots each add-on's price at purchase — so
   * subtracting them back out gives the base price the runner actually paid,
   * even if the organizer has since re-priced the add-on. `payment-session`
   * itemises the hosted checkout from the same identity.
   *
   * `admin_registrations_v` does not expose `base_price`, and this avoids a
   * migration to add it. `row.addons` arrives with the row itself now (see
   * getRegistrationAddons in @/lib/queries/registrations) — there is no
   * loading state to account for here any more.
   */
  const addonTotal = row.addons.reduce((sum, a) => sum + a.price, 0);
  const entryFee = row.total_amount - addonTotal;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent showCloseButton={false} className="registration-detail"
        onOpenAutoFocus={(event) => { event.preventDefault(); closeRef.current?.focus(); }}>
        <header className="registration-detail-header">
          <PhotoAvatar url={row.avatar_url} className="size-12"
            fallbackClassName={cn("text-base font-semibold", tint.bg, tint.fg)} fallback={initials(row.full_name)} />
          <div className="registration-detail-identity">
            <DialogTitle>{row.full_name ?? "Registration details"}</DialogTitle>
            <DialogDescription className="sr-only">Registration details, payment, entry, submitted answers and history.</DialogDescription>
            {row.email ? <div className="registration-detail-email"><span>{row.email}</span><CopyButton value={row.email} label="email" /></div> : null}
            <div className="registration-detail-status">
              {row.registration_status === "expired" || row.registration_status === "cancelled"
                ? <RegistrationStatusBadge status={row.registration_status} /> : <PaymentStatusBadge status={row.payment_status} />}
              {teamName ? <Badge variant="secondary" className="registration-detail-team">Team: {teamName}</Badge> : null}
            </div>
          </div>
          <Button ref={closeRef} variant="ghost" size="icon" aria-label="Close" onClick={onClose} className="shrink-0"><X className="size-5" aria-hidden /></Button>
        </header>
        <div className="registration-detail-body" role="region" aria-label="Registration information" tabIndex={0}>
          <section className={cn("registration-detail-money", money.band)} aria-label="Payment" data-payment-status={row.payment_status}>
            <div className="registration-detail-money-heading">
              <div><p className={cn("text-sm font-medium", money.ink)}>{money.eyebrow}</p>
                <p className={cn("mt-1 text-3xl font-semibold leading-tight tabular-nums", money.ink)}>{displayedAmount == null ? "Unavailable" : peso(displayedAmount)}</p></div>
              <MethodBadge method={row.payment_method} height={20} />
            </div>
            {row.addons.length > 0 || captured ? <dl className="registration-detail-breakdown">
              <Row label={row.category_label ? `${row.category_label} entry` : "Entry"} value={peso(entryFee)} mono />
              {row.addons.map((addon, index) => <Row key={index} label={addon.name ?? "Add-on"} value={peso(addon.price)} mono />)}
              {captured && row.payment_amount != null && row.payment_amount !== row.total_amount
                ? <Row label="Fees charged at checkout" value={peso(row.payment_amount - row.total_amount)} mono /> : null}
              {row.payment_status === "partially_refunded" && row.refunded_amount != null ? <Row label="Refunded" value={peso(row.refunded_amount)} mono /> : null}
            </dl> : null}
          </section>
          <Section title="Entry">
            <Row label="Category" value={row.category_label ?? "—"} />
            <Row label="Registered" value={fmtDateTime(row.created_at)} mono />
            <Row label="Registration ID" value={<span className="registration-detail-reference"><span>{row.id}</span><CopyButton value={row.id} label="registration id" /></span>} />
          </Section>
          {customEntries.length ? <Section title="Registration fields">{customEntries.map(([key, value]) => <Row key={key} label={fieldLabel(key)} value={fieldValue(value)} />)}</Section> : null}
          <section className="registration-detail-section" aria-label="History"><h3>History</h3><RegistrationHistory registrationId={row.id} /></section>
          <p className="registration-detail-refund-note">{complimentary ? "Cancel this free entry to release its slot. Its discount code stays used." : row.booking_order_id && row.payment_status === "paid"
            ? "Refunding this participant cancels their ticket and releases their slot. Other participants stay registered."
            : REFUND_REASON[row.payment_status ?? ""] ?? "No payment is recorded for this entry."}</p>
        </div>
        <footer className="registration-detail-footer">
          <Button variant="outline" onClick={onClose}>Done</Button>
          <Button variant="destructive" disabled={complimentary ? row.registration_status !== "paid" : !canRefund}
            onClick={() => complimentary ? setCancelling(true) : setRefunding(true)}>
            {complimentary ? "Cancel complimentary entry" : "Review refund"}
          </Button>
        </footer>
        {cancelling ? <BulkCancelDialog ids={[row.id]} onDone={onRefunded} onClose={() => setCancelling(false)} /> : null}
        {refunding ? <RefundModal registration={{ id: row.id, full_name: row.full_name, total_amount: row.total_amount, booking_order_id: row.booking_order_id }}
          onClose={() => setRefunding(false)} onDone={onRefunded} /> : null}
      </DialogContent>
    </Dialog>
  );
}
