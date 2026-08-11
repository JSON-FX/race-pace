"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { PhotoAvatar } from "@/components/PhotoAvatar";
import { Button } from "@/components/ui/button";
import { peso, fmtDateTime, initials } from "@/lib/format";
import { fieldLabel, fieldValue } from "@/lib/field-labels";
import { cn } from "@/lib/utils";
import type { RegistrationRow } from "@/lib/queries/registrations";
import { PaymentStatusBadge, RegistrationStatusBadge } from "./StatusBadge";
import { MethodBadge } from "./MethodBadge";
import { RefundModal } from "./RefundModal";
import { CopyButton } from "./CopyButton";
import { avatarTint } from "./RunnerAvatar";
import { RegistrationHistory } from "./RegistrationHistory";

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
  refunded: { eyebrow: "Refunded", band: "bg-info-tint", ink: "text-info" },
  failed: { eyebrow: "Payment failed", band: "bg-destructive-tint", ink: "text-destructive" },
};
const MONEY_FALLBACK = { eyebrow: "Amount", band: "bg-muted", ink: "text-foreground" };

/** Why the refund button is in the state it's in. A disabled control with no
 *  stated reason is the anti-pattern this replaces — the old modal greyed the
 *  button out and left the organizer to infer why. */
const REFUND_REASON: Record<string, string> = {
  paid: "Reopens the slot. Can't be undone.",
  pending: "Only a completed payment can be refunded.",
  refunded: "Already refunded — the slot went back on sale.",
  failed: "This payment never completed, so there's nothing to return.",
};

function Row({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    // items-start, not items-center: a long value (a club name, an address)
    // wraps to two lines, and centring would float the label off its own row.
    <div className="flex items-start justify-between gap-6 py-[3px] text-[12.5px]">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      {/* Values WRAP rather than truncate (§6 truncation-strategy) — this modal
          exists to show the full value, so hiding half of it behind an ellipsis
          would defeat the screen. */}
      <dd className={cn("min-w-0 text-right font-medium break-words", mono && "tabular-nums")}>{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-divider px-[18px] py-3">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">
        {title}
      </div>
      <dl>{children}</dl>
    </div>
  );
}

export function RegistrationDetail({ row, onClose, onRefunded }: {
  row: RegistrationRow; onClose: () => void; onRefunded: () => void;
}) {
  const [refunding, setRefunding] = useState(false);
  const canRefund = row.payment_status === "paid";
  const customEntries = Object.entries(row.custom_data ?? {});
  const money = MONEY[row.payment_status ?? ""] ?? MONEY_FALLBACK;
  const tint = avatarTint(row.id);

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
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
        // p-0 and gap-0 undo DialogContent's own padding so the tinted money
        // band and the footer can run edge to edge; every child below sets its
        // own px-[18px] instead. max-h + the scroll region keep a race with 12
        // custom questions inside the viewport.
        // w-[calc(100%-2rem)], not w-full: setting max-w-[460px] replaces
        // DialogContent's own max-w-[calc(100%-2rem)], which is what keeps a
        // 16px gutter on a phone — without it the panel runs edge to edge.
        className="top-[6vh] flex max-h-[88vh] w-[calc(100%-2rem)] max-w-[460px] translate-y-0 flex-col gap-0 overflow-hidden rounded-xl p-0 sm:max-w-[460px]"
      >
        {/* ── Who ───────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-start gap-3 px-[18px] pb-3.5 pt-4">
          <PhotoAvatar
            url={row.avatar_url}
            className="size-[38px]"
            fallbackClassName={cn("text-[13px] font-bold", tint.bg, tint.fg)}
            fallback={initials(row.full_name)}
          />

          <div className="min-w-0 flex-1">
            <DialogTitle className="text-[15px] font-semibold leading-tight">
              {row.full_name ?? "—"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Registration detail for {row.full_name ?? "this runner"}, including payment,
              entry and the answers they gave on the registration form.
            </DialogDescription>

            {row.email ? (
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="truncate text-[11.5px] text-muted-foreground">{row.email}</span>
                <CopyButton value={row.email} label="email" />
              </div>
            ) : null}

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {row.bib_name ? (
                <span className="rounded-pill bg-muted px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-foreground">
                  {row.bib_name}
                </span>
              ) : null}
              {/* Same registration_status-wins-for-expired/cancelled swap as
                  the table's Status column (registrations-table.tsx) — an
                  organizer opening the sheet for an abandoned or cancelled
                  entry should see the same badge they clicked through on. */}
              {row.registration_status === "expired" || row.registration_status === "cancelled" ? (
                <RegistrationStatusBadge status={row.registration_status} />
              ) : (
                <PaymentStatusBadge status={row.payment_status} />
              )}
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            aria-label="Close"
            className="-mr-1 -mt-1 size-8 shrink-0 text-muted-foreground"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </div>

        {/* Everything between the header and the refund bar scrolls, so the
            action never leaves the viewport on a long form (§9 modal-escape). */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* ── Money ──────────────────────────────────────────────────── */}
          <div className={cn("border-t border-divider px-[18px] py-3.5", money.band)}>
            <div className={cn("text-[10px] font-semibold uppercase tracking-[0.09em] opacity-75", money.ink)}>
              {money.eyebrow}
            </div>
            {/* tabular-nums so the peso figure doesn't reflow between rows of
                different digits (§6 number-tabular). */}
            <div className={cn("mt-px text-[29px] font-semibold leading-tight tracking-tight tabular-nums", money.ink)}>
              {peso(row.total_amount)}
            </div>

            {row.addons.length > 0 ? (
              <>
                <div className={cn("my-2.5 h-px bg-current opacity-20", money.ink)} />
                <dl>
                  <Row label={row.category_label ? `${row.category_label} entry` : "Entry"} value={peso(entryFee)} mono />
                  {row.addons.map((a, i) => (
                    <Row key={i} label={a.name ?? "Add-on"} value={peso(a.price)} mono />
                  ))}
                </dl>
              </>
            ) : null}
          </div>

          {/* ── How they paid ──────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-3 border-t border-divider px-[18px] py-3 text-[12.5px]">
            {/* shrink-0: MethodBadge is its own flex row, so without this it
                compresses to nothing on a phone and the brand marks end up
                touching the id beside them. */}
            <span className="shrink-0">
              <MethodBadge method={row.payment_method} height={15} />
            </span>
            <div className="flex min-w-0 items-center gap-1.5">
              {/* The registration id, not a provider reference: it's what `?reg=`
                  in the URL uses and what support threads quote, and unlike
                  payments.provider_ref it's already on this row. */}
              <span className="truncate font-mono text-[11px] text-muted-foreground">{row.id}</span>
              <CopyButton value={row.id} label="registration id" />
            </div>
          </div>

          {/* ── Entry ──────────────────────────────────────────────────── */}
          <Section title="Entry">
            <Row label="Category" value={row.category_label ?? "—"} />
            <Row label="Registered" value={fmtDateTime(row.created_at)} mono />
          </Section>

          {/* ── What they answered ─────────────────────────────────────── */}
          {customEntries.length ? (
            <Section title="Registration fields">
              {customEntries.map(([k, v]) => (
                <Row key={k} label={fieldLabel(k)} value={fieldValue(v)} />
              ))}
            </Section>
          ) : null}

          {/* ── Change history ─────────────────────────────────────────── */}
          <Section title="History">
            <RegistrationHistory registrationId={row.id} />
          </Section>
        </div>

        {/* ── Refund ─────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-muted/40 px-[18px] py-3">
          <span className="text-[11.5px] leading-snug text-muted-foreground">
            {REFUND_REASON[row.payment_status ?? ""] ?? "No payment is recorded for this entry."}
          </span>
          <Button
            variant="destructive"
            className="shrink-0 rounded-pill"
            disabled={!canRefund}
            onClick={() => setRefunding(true)}
          >
            Refund {peso(row.total_amount)}
          </Button>
        </div>

        {refunding ? (
          <RefundModal
            registration={{ id: row.id, full_name: row.full_name, total_amount: row.total_amount }}
            onClose={() => setRefunding(false)}
            // `revalidatePath` inside refundRegistrationAction already
            // re-renders the server page with fresh data — this callback
            // only needs to close the modal, not manually refetch anything.
            onDone={onRefunded}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
