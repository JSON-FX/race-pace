"use client";

import Link from "next/link";
import { formatPeso } from "@race-pace/shared";
import { Button } from "@/components/ui/button";
import type { RegistrationRow } from "@/lib/registration";
import { payLaterDeadline, paymentClosed } from "@/lib/pay-later";
import { useDeadline } from "@/lib/use-deadline";
import { longDate } from "@/lib/format";
import styles from "./ReservationCard.module.css";

// Synced from Race Pace's approved Pay Later catalog composition (Runner/RacePass).
export function ReservationCard({ registration: reg, runnerName }: {
  registration: RegistrationRow;
  runnerName?: string | null;
}) {
  useDeadline(reg.payLaterDueAt);
  const deadlinePassed = !!reg.payLaterDueAt && Date.parse(reg.payLaterDueAt) <= Date.now();
  const eventClosed = paymentClosed(reg.eventStatus ?? "", reg.eventRegistrationClosesAt, reg.payLaterDueAt);
  const expired = reg.status === "expired" || deadlinePassed || eventClosed;
  const payable = reg.status === "pending" && !expired && reg.orgIsActive;
  const closedReason = eventClosed
    ? "The organizer closed this event. This reservation is no longer valid."
    : deadlinePassed
      ? "The payment deadline passed. This reservation is no longer valid."
      : "This reservation was closed before payment. Contact the organizer for details.";
  const amount = reg.total_amount + (reg.feeMode === "pass_on" ? reg.checkoutPlatformFee ?? 0 : 0);
  return <article className={styles.ticket}>
    <div className={styles.main}>
      <p className={styles.status}>{expired ? deadlinePassed && !eventClosed ? "Expired" : "Entry closed" : "Reserved · unpaid"}</p>
      <h2>{reg.eventName}</h2>
      <p>{[reg.eventPlace, reg.eventDate ? longDate(reg.eventDate) : null].filter(Boolean).join(" · ")}</p>
      <dl>
        {runnerName && <div><dt>Runner</dt><dd>{runnerName}</dd></div>}
        <div><dt>Category</dt><dd>{reg.categoryLabel}</dd></div>
        <div><dt>{reg.feeMode === "pass_on" ? "Subtotal due" : "Amount due"}</dt><dd>{formatPeso(amount)}</dd></div>
        {reg.payLaterDueAt && <div><dt>Payment deadline</dt><dd>{payLaterDeadline(reg.payLaterDueAt)}</dd></div>}
      </dl>
      {reg.feeMode === "pass_on" && <p className={styles.fine}>Payment processing is calculated at checkout.</p>}
    </div>
    <div className={styles.stub}>
      <h3>{expired ? "Reservation closed" : "Your slot is held"}</h3>
      <p>{expired
        ? closedReason
        : payable
          ? "Pay before the deadline to unlock your check-in code."
          : "Payment is currently unavailable. Contact the organizer about this reservation."}</p>
      {payable && <Button asChild className={styles.pay}><Link href={`/pay/${reg.id}`}>Pay now</Link></Button>}
      <Button asChild variant="link" className={styles.details}><Link href={`/events/${reg.event_id}`}>Race details</Link></Button>
    </div>
  </article>;
}
