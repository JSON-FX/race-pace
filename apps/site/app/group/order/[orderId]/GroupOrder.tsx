"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatPeso } from "@race-pace/shared";
import { createClient } from "@/lib/supabase/client";
import { GroupCheckoutError, prepareGroupPayment, startGroupPayment, verifyGroupPayment, type GroupAttempt } from "@/lib/groupCheckout";
import { Button } from "@/components/ui/button";

type Ticket = { id: string; status: string; custom_data: Record<string, unknown> | null };
type Method = "gcash" | "card" | "maya";

export function GroupOrder({ orderId, initialStatus, entryTotal, eventName, categoryLabel, feeMode, expiresAt, returnStatus }: {
  orderId: string; initialStatus: string; entryTotal: number; eventName: string; categoryLabel: string;
  feeMode: "absorb" | "pass_on"; expiresAt: string | null; returnStatus?: string;
}) {
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
      db.from("registrations").select("id,status,custom_data").eq("booking_order_id", orderId).order("id"),
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

  const complete = status === "paid";
  const effectiveFeeMode = attempt?.terms_snapshot?.fee_mode ?? feeMode;
  const blocked = status === "reconciliation_required" || attempt?.status === "creation_unknown";
  const canPrepare = (!attempt || ["failed", "expired"].includes(attempt.status)) && !expired && status === "pending" && entryTotal > 0;
  const canPay = attempt && ["prepared", "ready"].includes(attempt.status) && status === "pending" && !expired;

  return <div className="mx-auto max-w-2xl px-5 py-12 sm:px-6">
    <p className="text-sm font-semibold uppercase tracking-widest text-primary">Group booking</p>
    <h1 className="mt-3 text-3xl font-bold">{eventName}</h1>
    <p className="mt-2 text-muted-foreground">{categoryLabel} · {tickets.length || "Your"} participant{tickets.length === 1 ? "" : "s"}</p>

    {!loaded ? <p className="mt-8 text-muted-foreground">Loading your booking…</p> : complete ? <section className="mt-8 rounded-xl border p-6">
      <h2 className="text-xl font-bold">Payment confirmed</h2>
      <p className="mt-2 text-sm text-muted-foreground">One payment secured {tickets.filter(ticket => ticket.status === "paid").length} individual tickets.</p>
      <ul className="mt-5 space-y-3">{tickets.map(ticket => {
        const name = typeof ticket.custom_data?.full_name === "string" ? ticket.custom_data.full_name : "Participant";
        return <li key={ticket.id} className="flex items-center justify-between rounded-lg border p-4"><span>{name}</span>
          {ticket.status === "paid" ? <Link href={`/ticket/${ticket.id}`} className="font-semibold underline">View QR ticket</Link> : <span className="capitalize">{ticket.status}</span>}
        </li>;
      })}</ul>
    </section> : <section className="mt-8 space-y-5">
      <div className="rounded-xl border p-6">
        <p className="font-semibold">Entry and add-ons: {formatPeso(entryTotal)}</p>
        {attempt ? <><p className="mt-2">Taxes and fees: {formatPeso(attempt.platform_fee_cents)} {effectiveFeeMode === "absorb" ? "included" : "added"}</p>
          <p className="mt-2 font-bold">{effectiveFeeMode === "pass_on" ? "Subtotal before PayMongo processing" : "Total to pay"}: {formatPeso(attempt.gross_cents)}</p></> : null}
        <p className="mt-2 text-sm text-muted-foreground">{effectiveFeeMode === "pass_on"
          ? "PayMongo shows the exact processing fee and final total after you choose a payment method."
          : "Race Pace and PayMongo fees are deducted from this price. They are not added to your total."}</p>
      </div>
      {blocked ? <p role="alert" className="rounded-lg border border-destructive p-4">This payment needs review. Do not start a new checkout. Contact Race Pace support with this booking ID: {orderId}.</p> : null}
      {expired || status === "expired" || status === "cancelled" ? <p role="alert">This reservation is no longer payable. No new payment will be started.</p> : null}
      {canPrepare ? <><label className="block font-medium" htmlFor="group-method">Payment method</label>
        <select id="group-method" value={method} onChange={event => setMethod(event.target.value as Method)} className="w-full rounded-lg border bg-background p-3">
          <option value="gcash">GCash</option><option value="card">Card</option><option value="maya">Maya</option>
        </select><Button disabled={busy} onClick={prepare} className="w-full">{attempt ? "Review another payment attempt" : "Review one payment"}</Button></> : null}
      {canPay && !blocked ? <Button disabled={busy} onClick={pay} className="w-full">Continue to PayMongo</Button> : null}
      {attempt && !complete ? <Button variant="outline" disabled={busy} onClick={check} className="w-full">Check payment status</Button> : null}
    </section>}
    {error ? <p role="alert" className="mt-5 text-sm text-destructive">{error}</p> : null}
    <Link className="mt-8 inline-block text-sm underline" href="/bookings">Bookings I manage</Link>
  </div>;
}
