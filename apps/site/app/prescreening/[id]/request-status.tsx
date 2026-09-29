"use client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatPeso } from "@race-pace/shared";
import type { EventRow } from "@/lib/events";
import { screeningSummary, screeningDate, screeningParticipantFee, type ScreeningBatch } from "@/lib/prescreening-status";
import { createClient } from "@/lib/supabase/client";
import { screeningOperation } from "@/lib/prescreening";
import { Button } from "@/components/ui/button";
import { ScreeningEmailStatus } from "@/components/prescreening/ScreeningEmailStatus";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { ArrowLeft, ArrowRight, Check, Clock3, Info, ShieldCheck } from "lucide-react";
import { MethodLogo } from "@/components/PaymentLogos";
import { PassportAvatar } from "@/components/prescreening/PassportAvatar";
import styles from "@/components/prescreening/screening.module.css";

const METHODS = [
  { value: "gcash", logo: "gcash", label: "GCash" },
  { value: "paymaya", logo: "maya", label: "Maya" },
  { value: "card", logo: "card", label: "Card" },
  { value: "qrph", logo: "qrph", label: "QR Ph" },
];
import { AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";

export function RequestStatus({ batch, event }: { batch: ScreeningBatch; event: EventRow }) {
  const router = useRouter(); const [now, setNow] = useState(Date.now());
  const [method, setMethod] = useState("gcash");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { const timer = setInterval(() => { setNow(Date.now()); router.refresh(); }, 30000); return () => clearInterval(timer); }, [router]);
  const summary = screeningSummary(batch, now);
  const isReservation = batch.checkout_intent === "reservation";
  const total = summary.remaining.reduce((sum, a) => sum + screeningParticipantFee(a, batch.checkout_intent), 0);
  async function cancel() {
    setBusy(true); setError(null);
    const result = await createClient().rpc("prescreening_cancel", { p_batch: batch.id });
    if (result.error) setError(result.error.message.includes("payment_already_started") ? "A checkout has already started. Open your booking to check its payment before cancelling." : "This request could not be cancelled. Your holds remain unchanged.");
    setBusy(false); router.refresh();
  }
  async function payReservation() {
    setBusy(true); setError(null);
    try {
      const result = await screeningOperation<{ reservation_id: string; checkout_url?: string }>("reservation-checkout", {
        event_id: batch.event_id, idempotency_key: batch.id, prescreening_batch_id: batch.id,
        method, return_url: `${window.location.origin}/reservations/callback`,
        participants: summary.remaining.map(a => ({ participant_passport_id: a.participant_passport_id, category_id: a.category_id })),
      });
      if (result.checkout_url) window.location.assign(result.checkout_url);
      else router.push(`/reservations/${result.reservation_id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Payment unavailable. Try again."); }
    finally { setBusy(false); }
  }
  const existing = batch.booking_order_id ? `/group/order/${batch.booking_order_id}` : batch.event_reservation_id ? `/reservations/${batch.event_reservation_id}` : null;
  const selectedMethod = METHODS.find(item => item.value === method)!;
  const deadline = batch.payment_deadline_at ? new Date(batch.payment_deadline_at) : null;
  const hoursLeft = deadline ? Math.max(0, Math.ceil((deadline.getTime() - now) / 3600000)) : 0;
  const StatusIcon = summary.payable || batch.status === "completed" ? Check : summary.deadlinePassed || batch.status === "expired" ? Clock3 : ShieldCheck;
  return <main className={styles.workspace}><div className={styles.wrap}>
    <header className={styles.heading}>
      <Link href={`/events/${event.slug ?? event.id}`} className={styles.breadcrumb}><ArrowLeft aria-hidden="true" /><span>{event.name}</span></Link>
      <h1>My pre-screening request</h1><p>Submitted {screeningDate(batch.created_at)} PHT</p>
    </header>
    <div className={styles.columns}>
      <section className={styles.panel} aria-labelledby="request-status-heading">
        <div className={styles.banner} role="status"><span className={styles.bannerIcon}><StatusIcon aria-hidden="true" /></span><div><h2 id="request-status-heading">{summary.title}</h2><p>{summary.detail}</p></div></div>
        {batch.prescreening_applications.map(a => <article key={a.id} className={styles.member}>
          <PassportAvatar name={a.participant_name} managed={a.is_managed} />
          <div className={styles.memberInfo}><h3>{a.participant_name}</h3><p>{a.categories.label} · {a.is_managed ? "Managed Passport" : "Your Passport"}</p>
            <p>{a.decision === "rejected" ? "Slot released" : batch.status === "completed" ? "Paid booking" : a.released_at ? "Slot released" : "Slot held"}</p></div>
          <Badge className={`${styles.badge} ${a.decision === "rejected" ? styles.rejected : a.decision === "pending" ? styles.pending : styles.approved}`}>{a.decision === "not_required" ? "No review needed" : a.decision === "pending" ? "Pending review" : a.decision === "approved" ? "Approved" : "Rejected"}</Badge>
          {a.rejection_reason && <div className={styles.reason}><strong>Organizer’s reason</strong><p>{a.rejection_reason}</p><Link href={`/events/${event.slug ?? event.id}`}>Choose another category</Link><p>A new registration is subject to availability. It does not change this group’s deadline.</p></div>}
        </article>)}
        <div className={styles.note}><Info aria-hidden="true" /><p>Rejection releases only that runner’s slot. Categories without pre-screening wait with the group. Email resends and payment retries never restart the 72 hours.</p></div>
        <div className={styles.actions}><Button variant="outline" className={`${styles.button} ${styles.secondaryButton}`} onClick={() => router.refresh()}>Refresh status</Button>
          {["reviewing", "ready"].includes(batch.status) && <AlertDialog><AlertDialogTrigger asChild><Button variant="ghost" className={styles.button} disabled={busy}>Cancel request</Button></AlertDialogTrigger>
            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Release this group’s review holds?</AlertDialogTitle><AlertDialogDescription>Every unpaid slot held by this request will become available again. Any started provider checkout must be resolved first.</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>Keep request</AlertDialogCancel><AlertDialogAction onClick={() => void cancel()}>Cancel request</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}
        </div>{error && <Alert variant="destructive" className="mt-4 text-sm text-destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      </section>
      <aside className={`${styles.panel} ${styles.aside}`} aria-labelledby="next-step-heading"><h2 id="next-step-heading">Your next step</h2>
        {deadline && batch.status === "ready" && <div><p className={styles.small}>Complete payment by</p><p className={styles.deadline}>
          {new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric" }).format(deadline)}
          <small>{new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" }).format(deadline)} PHT · {hoursLeft ? `${hoursLeft} ${hoursLeft === 1 ? "hour" : "hours"} remaining` : "Window ended"}</small></p></div>}
        {summary.payable && <><ul>{summary.remaining.map(a => <li key={a.id} className={styles.receipt}><span>{a.participant_name}<span>{a.categories.label}</span></span><strong>{formatPeso(screeningParticipantFee(a, batch.checkout_intent))}</strong></li>)}</ul>
          <div className={`${styles.receipt} ${styles.total}`}><span>{isReservation ? "Reservation fees" : "Entry fees"}</span><strong>{formatPeso(total)}</strong></div>
          <p className={styles.small}>Platform and processing fees are shown before payment.</p>
          {isReservation && <Select value={method} onValueChange={setMethod} disabled={busy}>
            <SelectTrigger className={styles.method} aria-label="Reservation payment method"><span className={styles.methodLabel}><MethodLogo methodKey={selectedMethod.logo} /><span>{selectedMethod.label}</span></span></SelectTrigger>
            <SelectContent position="popper" className="min-w-[var(--radix-select-trigger-width)]">{METHODS.map(item => <SelectItem key={item.value} value={item.value}><span className={styles.methodLabel}><MethodLogo methodKey={item.logo} /><span>{item.label}</span></span></SelectItem>)}</SelectContent></Select>}
          {isReservation ? <Button className={`${styles.button} ${styles.fullButton}`} disabled={busy} onClick={() => void payReservation()}>{busy ? "Preparing…" : <>Continue to reservation <ArrowRight aria-hidden="true" /></>}</Button>
            : existing ? <Button className={`${styles.button} ${styles.fullButton}`} asChild><Link href={existing}>Continue to payment <ArrowRight aria-hidden="true" /></Link></Button>
            : <Button className={`${styles.button} ${styles.fullButton}`} asChild><Link href={`/register/${summary.remaining[0].category_id}/group?prescreening=${batch.id}`}>Complete entry details <ArrowRight aria-hidden="true" /></Link></Button>}
          {isReservation && <p className={styles.meta}>The reservation fee is separate and nonrefundable. It is not deducted from full entry payment.</p>}
        </>}
        {!summary.payable && batch.status !== "completed" && <><p className={styles.small}>{summary.pending ? `${summary.pending} ${summary.pending === 1 ? "participant is" : "participants are"} still awaiting review. No payment is due yet.` : summary.detail}</p>
          {batch.status === "reviewing" && <><ul>{summary.remaining.map(a => <li key={a.id} className={styles.receipt}><span>{a.participant_name}<span>{a.categories.label}</span></span><strong>{a.released_at ? "Released" : "Slot held"}</strong></li>)}</ul>
            <div className={`${styles.receipt} ${styles.total}`}><span>Due now</span><strong>₱0</strong></div><p className={styles.small}>Every listed slot stays held while required reviews are pending. You will pay together after approval.</p></>}
          <Button className={`${styles.button} ${styles.fullButton}`} disabled>{summary.pending ? "Waiting for group approval" : "Payment unavailable"}</Button></>}
        {existing && !summary.payable && <Button className={`${styles.button} ${styles.fullButton}`} variant="outline" asChild><Link href={existing}>View booking</Link></Button>}
        <ScreeningEmailStatus batchId={batch.id} payable={summary.payable} />
        <Link href="/prescreening" className={styles.allRequests}>All my requests</Link>
      </aside>
    </div>
  </div></main>;
}
