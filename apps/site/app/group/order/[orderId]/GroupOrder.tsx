"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatPeso } from "@race-pace/shared";
import { ArrowLeft, CheckCircle2, QrCode } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cancelGroupOrder, GroupCheckoutError, prepareGroupPayment, startGroupPayment, verifyGroupPayment, type GroupAttempt } from "@/lib/groupCheckout";
import { MethodLogo } from "@/components/PaymentLogos";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

type Ticket = { id: string; status: string; total_amount: number; custom_data: Record<string, unknown> | null; categories: { label: string } | { label: string }[] | null };
type Method = "gcash" | "card" | "maya" | "qrph";
const METHOD_LABELS: Record<Method, string> = { gcash: "GCash", card: "Card", maya: "Maya", qrph: "QR Ph" };

export function GroupOrder({ orderId, initialStatus, entryTotal, eventName, categoryLabel, categoryCount, participantCount, feeMode, expiresAt, rosterHref, returnStatus }: {
  orderId: string; initialStatus: string; entryTotal: number; eventName: string; categoryLabel: string; participantCount: number;
  categoryCount: number; feeMode: "absorb" | "pass_on"; expiresAt: string | null; rosterHref: string; returnStatus?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [attempt, setAttempt] = useState<GroupAttempt | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [method, setMethod] = useState<Method>("gcash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const verifiedReturn = useRef(false);
  const expired = expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false;

  const refresh = useCallback(async () => {
    const db = createClient();
    const [order, attempts, registrations] = await Promise.all([
      db.from("booking_orders").select("status").eq("id", orderId).single(),
      db.from("booking_payment_attempts").select("id,booking_order_id,status,method,base_cents,platform_fee_cents,gross_cents,terms_snapshot").eq("booking_order_id", orderId).order("created_at", { ascending: false }).limit(1),
      db.from("registrations").select("id,status,total_amount,custom_data,categories(label)").eq("booking_order_id", orderId).order("id"),
    ]);
    if (order.error || attempts.error || registrations.error) throw new Error("Could not load the group booking");
    setStatus(order.data.status);
    setAttempt((attempts.data?.[0] as GroupAttempt | undefined) ?? null);
    setTickets((registrations.data ?? []) as Ticket[]);
    setLoaded(true);
  }, [orderId]);

  useEffect(() => {
    refresh().catch(cause => setError(cause instanceof Error ? cause.message : "Could not load booking"));
    const timer = window.setInterval(() => refresh().catch(() => {}), 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!returnStatus || !attempt || verifiedReturn.current || status === "paid") return;
    verifiedReturn.current = true;
    verifyGroupPayment(attempt.id).then(refresh).catch(() => setError("Payment is still being checked. Use Check payment status below."));
  }, [returnStatus, attempt, status, refresh]);

  useEffect(() => {
    if (status !== "paid") return;
    try { sessionStorage.removeItem(`rp:group-payment:${orderId}`); } catch { /* No storage access. */ }
  }, [orderId, status]);

  async function prepare() {
    setError(null); setBusy(true);
    try {
      const storageKey = `rp:group-payment:${orderId}`;
      let key: string;
      try {
        key = attempt && ["failed", "expired"].includes(attempt.status)
          ? crypto.randomUUID() : sessionStorage.getItem(storageKey) ?? crypto.randomUUID();
        sessionStorage.setItem(storageKey, key);
      }
      catch { key = crypto.randomUUID(); }
      const prepared = await prepareGroupPayment(orderId, method, key);
      setAttempt(prepared);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Payment unavailable"); }
    finally { setBusy(false); }
  }

  async function pay() {
    if (!attempt) return;
    setError(null); setBusy(true);
    try {
      const session = await startGroupPayment(attempt.id);
      if (session.action === "ready" && session.checkout_url) { window.location.assign(session.checkout_url); return; }
      setError("PayMongo is preparing your checkout. Check the booking status shortly.");
      await refresh();
    } catch (cause) {
      const code = cause instanceof GroupCheckoutError ? cause.code : "payment_unavailable";
      setError(code === "payment_creation_unknown"
        ? "PayMongo may have created a checkout. Do not start another payment. We are checking this attempt."
        : cause instanceof Error ? cause.message : "Payment unavailable");
      await refresh().catch(() => {});
    } finally { setBusy(false); }
  }

  async function check() {
    if (!attempt) return;
    setBusy(true); setError(null);
    try { await verifyGroupPayment(attempt.id); await refresh(); }
    catch { setError("We could not confirm a payment yet. Your booking will update after provider confirmation."); }
    finally { setBusy(false); }
  }

  async function cancelBooking() {
    setBusy(true); setError(null);
    try {
      await cancelGroupOrder(orderId);
      try { sessionStorage.removeItem(`rp:group-payment:${orderId}`); } catch { /* No storage access. */ }
      router.push(rosterHref);
      router.refresh();
    } catch (cause) {
      const code = cause instanceof GroupCheckoutError ? cause.code : "booking_cancellation_unavailable";
      setError(code === "payment_already_started"
        ? "Payment has already started. Check its status before changing participants."
        : "We could not cancel this booking. Please try again.");
      await refresh().catch(() => {});
    } finally { setBusy(false); }
  }

  const complete = status === "paid";
  const effectiveFeeMode = attempt?.terms_snapshot?.fee_mode ?? feeMode;
  const blocked = status === "reconciliation_required" || attempt?.status === "creation_unknown";
  const canPrepare = (!attempt || ["failed", "expired"].includes(attempt.status)) && !expired && status === "pending" && entryTotal > 0;
  const canPay = attempt && ["prepared", "ready"].includes(attempt.status) && status === "pending" && !expired;
  const canCancel = loaded && status === "pending" && !expired && (!attempt || ["prepared", "failed", "expired"].includes(attempt.status));
  const categoryBadge = categoryCount > 1 ? `${categoryCount} categories` : categoryLabel;

  return <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
    <Link className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground" href="/bookings"><ArrowLeft aria-hidden="true" className="size-4" />Back to bookings</Link>
    <Card className="gap-0 overflow-hidden rounded-3xl border-border/70 py-0 shadow-[0_20px_55px_rgba(20,35,25,0.08)]">
      <CardHeader className="gap-3 border-b border-border/70 p-6 sm:p-8 lg:px-10 lg:py-9">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Group booking · payment</p>
        <CardTitle className="text-3xl tracking-tight sm:text-4xl">{eventName}</CardTitle>
        <CardDescription className="text-base">Review the runners and categories before continuing to PayMongo.</CardDescription>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant="secondary" className="border border-border/70">{participantCount} participant{participantCount === 1 ? "" : "s"}</Badge>
          <Badge variant="secondary" className="border border-border/70">{categoryBadge}</Badge>
          <Badge variant="secondary" className="border border-border/70">{participantCount} QR ticket{participantCount === 1 ? "" : "s"} after payment</Badge>
        </div>
      </CardHeader>

    {!loaded ? <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.8fr)] lg:p-10"><div className="space-y-3"><Skeleton className="h-5 w-48" /><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div><Skeleton className="h-80 w-full" /></div> : complete ? <section className="p-6 sm:p-8 lg:p-10">
      <h2 className="flex items-center gap-2 text-xl font-bold"><CheckCircle2 aria-hidden="true" className="size-5 text-primary" />Payment confirmed</h2>
      <p className="mt-2 text-sm text-muted-foreground">One payment secured {tickets.filter(ticket => ticket.status === "paid").length} individual tickets.</p>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2">{tickets.map(ticket => {
        const name = typeof ticket.custom_data?.full_name === "string" ? ticket.custom_data.full_name : "Participant";
        const category = Array.isArray(ticket.categories) ? ticket.categories[0] : ticket.categories;
        return <li key={ticket.id} className="flex items-center justify-between gap-4 rounded-xl border p-4"><span><span className="block font-medium">{name}</span><span className="text-sm text-muted-foreground">{category?.label ?? "Category"}</span></span>
          {ticket.status === "paid" ? <Button asChild variant="outline"><Link href={`/ticket/${ticket.id}`}><QrCode aria-hidden="true" />View QR ticket</Link></Button> : <span className="capitalize">{ticket.status}</span>}
        </li>;
      })}</ul>
    </section> : <div className="grid lg:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.8fr)]">
      <section className="p-6 sm:p-8 lg:p-10">
        <div className="mb-4 flex items-center justify-between gap-4"><h2 className="text-lg font-semibold">Runners in this booking</h2><span className="text-sm text-muted-foreground">{tickets.length} entries</span></div>
        <ul className="space-y-3">{tickets.map(ticket => {
          const name = typeof ticket.custom_data?.full_name === "string" ? ticket.custom_data.full_name : "Participant";
          const category = Array.isArray(ticket.categories) ? ticket.categories[0] : ticket.categories;
          const initials = name.split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase();
          return <li key={ticket.id} className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-border/70 p-4">
            <span className="grid size-11 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">{initials}</span>
            <span><span className="block font-semibold">{name}</span><span className="text-sm text-muted-foreground">{category?.label ?? "Category"}</span></span>
            <span className="text-right"><span className="block font-semibold tabular-nums">{formatPeso(ticket.total_amount)}</span><span className="text-xs text-muted-foreground">Entry fee</span></span>
          </li>;
        })}</ul>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-muted/70 p-4 text-sm"><strong className="block">One payment</strong><span className="text-muted-foreground">Pay once for this entire booking.</span></div>
          <div className="rounded-xl bg-muted/70 p-4 text-sm"><strong className="block">Separate tickets</strong><span className="text-muted-foreground">Each runner receives their own QR.</span></div>
          <div className="rounded-xl bg-muted/70 p-4 text-sm"><strong className="block">Saved booking</strong><span className="text-muted-foreground">Return here to check payment status.</span></div>
        </div>
      </section>
      <aside className="border-t border-border/70 bg-muted/20 p-6 sm:p-8 lg:border-t-0 lg:border-l lg:p-10">
        <Card className="gap-4 rounded-2xl border-border bg-background py-6 shadow-none">
          <CardHeader className="px-6"><CardTitle>Payment summary</CardTitle></CardHeader>
          <CardContent className="space-y-4 px-6">
            <div className="flex justify-between gap-4 text-sm"><span className="text-muted-foreground">Entries and add-ons</span><strong className="tabular-nums">{formatPeso(entryTotal)}</strong></div>
            {attempt ? <div className="flex justify-between gap-4 text-sm"><span className="text-muted-foreground">Race Pace fees</span><strong>{effectiveFeeMode === "absorb" ? "Included" : formatPeso(attempt.platform_fee_cents)}</strong></div> : null}
            <Separator />
            <div className="flex items-end justify-between gap-4"><span className="font-semibold">{effectiveFeeMode === "pass_on" ? "Subtotal before processing" : "Total to pay"}</span><strong className="text-xl tabular-nums">{formatPeso(attempt?.gross_cents ?? entryTotal)}</strong></div>
            <p className="text-xs text-muted-foreground">{effectiveFeeMode === "pass_on" ? "PayMongo shows the exact processing fee before confirmation." : "Race Pace and PayMongo fees are included in this total."}</p>
            {blocked ? <p role="alert" className="rounded-lg border border-destructive p-3 text-sm">This payment needs review. Do not start another checkout. Contact Race Pace support with booking ID {orderId}.</p> : null}
            {expired || status === "expired" || status === "cancelled" ? <p role="alert" className="text-sm text-destructive">This reservation is no longer payable. No new payment will be started.</p> : null}
            {canPrepare ? <div className="space-y-2"><label className="text-sm font-medium" htmlFor="group-method">Payment method</label>
              <Select value={method} onValueChange={value => setMethod(value as Method)}>
                <SelectTrigger id="group-method" className="h-12 w-full"><span className="flex items-center gap-2"><MethodLogo methodKey={method} /><span>{METHOD_LABELS[method]}</span></span></SelectTrigger>
                <SelectContent position="popper" align="start" className="w-[var(--radix-select-trigger-width)]">{(Object.keys(METHOD_LABELS) as Method[]).map(value => <SelectItem key={value} value={value}><MethodLogo methodKey={value} /><span>{METHOD_LABELS[value]}</span></SelectItem>)}</SelectContent>
              </Select>
              <Button disabled={busy} onClick={prepare} className="h-12 w-full">{busy ? "Preparing payment…" : "Review one payment"}</Button></div> : null}
            {attempt && !canPrepare ? <div className="flex items-center justify-between rounded-lg border p-3 text-sm"><span className="text-muted-foreground">Payment method</span><span className="flex items-center gap-2 font-medium"><MethodLogo methodKey={attempt.method} />{METHOD_LABELS[attempt.method as Method] ?? attempt.method}</span></div> : null}
            {canPay && !blocked ? <Button disabled={busy} onClick={pay} className="h-12 w-full">{busy ? "Opening PayMongo…" : "Continue to PayMongo"}</Button> : null}
            {attempt && !complete ? <Button variant="outline" disabled={busy} onClick={check} className="h-11 w-full">Check payment status</Button> : null}
            {canCancel ? <AlertDialog>
              <AlertDialogTrigger asChild><Button variant="ghost" disabled={busy} className="h-11 w-full text-muted-foreground">Change participants</Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Cancel this group booking?</AlertDialogTitle>
                  <AlertDialogDescription>This unpaid booking will be cancelled and its held spots released. You will return to the Trail Roster, where you can select only yourself or choose a different group.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>Keep this booking</AlertDialogCancel>
                  <AlertDialogAction disabled={busy} onClick={cancelBooking}>{busy ? "Cancelling…" : "Cancel and edit roster"}</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog> : null}
            <p className="text-center text-xs text-muted-foreground">Also accepts Maya, QR Ph, Visa, and Mastercard.</p>
          </CardContent>
        </Card>
      </aside>
    </div>}
    {error ? <p role="alert" className="border-t px-6 py-4 text-sm text-destructive sm:px-8">{error}</p> : null}
    </Card>
  </div>;
}
