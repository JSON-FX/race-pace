"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Lock, ShieldCheck } from "lucide-react";
import { formatPeso } from "@race-pace/shared";
import { isRegistrationClosed } from "@/lib/eventStatus";
import { holdExpired } from "@/lib/holdExpiry";
import { useRegistration, createMethodCheckout, inspectCheckoutMethods } from "@/lib/registration";
import { checkoutErrorMessage } from "@/lib/errors";
import { PAY_METHODS, breakdown } from "@/lib/payment";
import { longDate } from "@/lib/format";
import { MethodLogo } from "@/components/PaymentLogos";
import { RefundNotice } from "@/components/RefundNotice";
import { RaceBib, RaceBibHeading } from "@/components/registration/RaceBib";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import styles from "./PayPanel.module.css";

export function PayPanel({ registrationId }: { registrationId: string }) {
  const reg = useRegistration(registrationId);
  const [method, setMethod] = useState("gcash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (reg.isLoading) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <p className="py-20 text-center text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (!reg.data) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <p className="py-20 text-center text-muted-foreground">We couldn&apos;t find that registration.</p>
      </div>
    );
  }

  // A saved payment URL outlives its registration. Never offer another checkout
  // after payment or refund, even when the original provider URL remains stored.
  if (reg.data.status !== "pending" && reg.data.status !== "expired") {
    const paid = reg.data.status === "paid";
    const title = paid ? "Registration paid"
      : reg.data.status === "refunded" ? "Registration refunded"
        : reg.data.status === "cancelled" ? "Registration cancelled"
          : "Payment unavailable";
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-20 text-center">
        <h1 className="text-[26px] font-semibold tracking-[-0.5px] text-foreground">{title}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          {paid ? "Your registration is paid. You do not need to pay again." : "This registration can no longer be paid. Check My Races for its status."}
        </p>
        <Button asChild className="mt-8 h-auto rounded-pill px-8 py-4 text-[16px] font-semibold">
          <Link href={paid ? `/ticket/${registrationId}` : "/races"}>{paid ? "View ticket" : "Back to My Races"}</Link>
        </Button>
      </div>
    );
  }

  const total = reg.data.total_amount;
  const { entry, addons } = breakdown(total, reg.data.basePrice);
  const inclusions = reg.data.inclusions ?? [];

  // PayMongo v2 chooses the method and calculates the exact processing fee on
  // its hosted page. The frozen Race Pace fee is the only extra amount we can
  // honestly show before redirecting.
  const passOn = reg.data.feeMode === "pass_on";
  const hostedPayMongo = reg.data.payment?.provider === "paymongo";
  const allowStoredFallback = reg.data.payment?.provider === "fake";
  const platformFee = reg.data.checkoutPlatformFee;
  const due = passOn ? null : total;

  // The organizer can cancel while this page is open — the query polls, so the
  // status can flip under the runner. The server page redirects on load; this
  // covers the live case. Critical because `reg.data.checkoutUrl` holds a
  // PayMongo session created while the event was open and still chargeable.
  const eventClosed = isRegistrationClosed(reg.data.eventStatus ?? "", reg.data.eventRegistrationClosesAt);
  if (eventClosed) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-20 text-center">
        <h1 className="text-[26px] font-semibold tracking-[-0.5px] text-foreground">
          This race is no longer accepting entries
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          {reg.data.statusNote ??
            "The organizer closed registration for this event. You have not been charged."}
        </p>
        <Button asChild className="mt-8 h-auto rounded-pill px-8 py-4 text-[16px] font-semibold">
          <Link href="/races">Back to My Races</Link>
        </Button>
      </div>
    );
  }

  // THE ORGANIZER'S ORGANIZATION IS SUSPENDED. Same shape and same reason as
  // `eventClosed` above: `reg.data.checkoutUrl` holds an all-methods PayMongo
  // session created before the suspension, and PayMongo does not care that the
  // platform switched the organizer off — that page is still chargeable, and
  // registrations-checkout writes `checkout_url` on EVERY registration, so it
  // is never absent.
  //
  // payment-session refuses to mint a NEW session for a suspended org
  // (org_suspended, 409). That refusal alone was not enough: `pay()` below fell
  // back to the stored session whenever the scoped call returned nothing, gated
  // only on the event being closed, so the server's refusal was routed around
  // on the dominant path. Removing the Pay button entirely is what actually
  // closes it.
  //
  // The copy is `checkoutErrorMessage("org_suspended")` — the same string
  // lib/errors.ts gives the registration path — rather than a second sentence
  // written here that would drift from it.
  const orgSuspended = !reg.data.orgIsActive;
  if (orgSuspended) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-20 text-center">
        <h1 className="text-[26px] font-semibold tracking-[-0.5px] text-foreground">
          This organizer is not taking payments
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          {checkoutErrorMessage("org_suspended")}
        </p>
        <Button asChild className="mt-8 h-auto rounded-pill px-8 py-4 text-[16px] font-semibold">
          <Link href="/races">Back to My Races</Link>
        </Button>
      </div>
    );
  }

  // A registration also reaches `status === 'expired'` when the organizer
  // closes/cancels/completes the event early, via the
  // `events_close_expires_pending` trigger (20260809100200) — not just when
  // the 24h hold lapses (that path is `lapsed`, below). `eventClosed` above
  // catches the common case, since the event flips status in the same
  // transaction. But it does NOT cover the organizer reopening the event
  // afterward: eventStatus goes back to something registerable while this
  // specific registration stays 'expired' forever (nothing resurrects it),
  // and its stored PayMongo session remains chargeable until explicitly expired. So
  // `status` must be checked directly here — this is a different fact from a
  // runner-abandoned hold (`lapsed`) and needs its own, distinct copy.
  const expiredByOrganizer = reg.data.status === "expired";
  if (expiredByOrganizer) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-20 text-center">
        <h1 className="text-[26px] font-semibold tracking-[-0.5px] text-foreground">This entry was closed</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          The organizer closed this registration before you paid. You have not been charged.
        </p>
        <Button asChild className="mt-8 h-auto rounded-pill px-8 py-4 text-[16px] font-semibold">
          <Link href={`/events/${reg.data.event_id}`}>Enter again</Link>
        </Button>
      </div>
    );
  }

  // Same live-case reasoning as eventClosed above: the server page's redirect
  // only catches a hold that had ALREADY lapsed on load. This query polls, so
  // a hold that runs out while the runner is sitting on this exact page (or
  // opened it from a stale bookmark right as the sweep would have caught it)
  // has to be caught here too — derived from expires_at via holdExpired, not
  // `status`, which stays 'pending' until the 15-minute sweep runs.
  const lapsed = holdExpired(reg.data.status, reg.data.expiresAt);
  if (lapsed) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-20 text-center">
        <h1 className="text-[26px] font-semibold tracking-[-0.5px] text-foreground">
          Payment window closed
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">
          This hold ran out and the slot is back in the pool. You&apos;ll need to enter again.
        </p>
        <Button asChild className="mt-8 h-auto rounded-pill px-8 py-4 text-[16px] font-semibold">
          <Link href={`/events/${reg.data.event_id}`}>Enter again</Link>
        </Button>
      </div>
    );
  }

  if (passOn && reg.data.payment?.provider !== "fake" &&
      (!reg.data.checkoutProviderManagedFee || platformFee === null)) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-20 text-center">
        <h1 className="text-[26px] font-semibold text-foreground">Checkout needs updating</h1>
        <p className="mt-3 text-[15px] text-muted-foreground">
          This reservation has an older payment link. Please contact Race Pace support before paying.
        </p>
      </div>
    );
  }

  async function pay() {
    setBusy(true);
    setError(null);
    // Remember which registration is in flight, so /pay/callback can recover
    // it if PayMongo drops the rid from the return URL.
    sessionStorage.setItem("rp:paying", registrationId);

    const scoped = await createMethodCheckout(registrationId, method);
    // The server's refusal is fresher than the rendered registration. In
    // particular, not_pending must never fall back to a pre-refund session.
    const url = scoped.code ? null :
      scoped.url ??
      (!allowStoredFallback || passOn || isRegistrationClosed(reg.data!.eventStatus ?? "", reg.data!.eventRegistrationClosesAt)
        || !reg.data!.orgIsActive
        || reg.data!.status !== "pending"
        || holdExpired(reg.data!.status, reg.data!.expiresAt)
        ? null
        : reg.data!.checkoutUrl);
    if (!url) {
      setBusy(false);
      // The mapped copy when the server said why, so a permanent refusal does
      // not read as "try registering again" — which is what the generic line
      // below invites, and is wrong advice for a suspended organizer.
      setError(
        scoped.code
          ? checkoutErrorMessage(scoped.code)
          : "No checkout link is available. Go back and try registering again.",
      );
      return;
    }
    // Full-page redirect off-site; /pay/callback resumes when PayMongo returns.
    window.location.assign(url);
  }

  return (
    <RaceBib
      step={4}
      eventName={reg.data.eventName}
      categoryLabel={reg.data.categoryLabel}
      distanceKm={reg.data.categoryDistance}
      dateLabel={reg.data.eventDate ? longDate(reg.data.eventDate) : null}
      organizer={reg.data.orgName}
      place={reg.data.eventPlace}
      amount={total + (passOn ? platformFee ?? 0 : 0)}
      amountLabel={passOn ? "Subtotal before processing" : "Total due"}
      note={passOn ? "Payment processing is calculated at PayMongo checkout." : "The amount shown includes all fees for this entry."}
    >
      <RaceBibHeading step={4} icon={<Lock />} title="Finish your entry" description="Your slot is held while you complete the secure checkout." />
      <div className={styles.holdBanner}><ShieldCheck size={18} aria-hidden="true" /><span><strong>Secure payment with PayMongo</strong><small>{passOn ? "You will see the exact processing fee before confirming payment." : "You will review the final amount before confirming payment."}</small></span></div>
      <div className={styles.payGrid}>
        <section className={styles.reviewCard}>
          <h3>Payment summary</h3>
          <dl>
            <PaymentRow label="Entry fee" value={formatPeso(entry)} />
            {addons > 0 ? <PaymentRow label="Add-ons" value={`+${formatPeso(addons)}`} /> : null}
            {passOn && platformFee !== null && platformFee > 0 ? <PaymentRow label="Taxes and fees" value={`+${formatPeso(platformFee)}`} /> : null}
            <PaymentRow label={passOn ? "Subtotal before processing" : "Subtotal"} value={formatPeso(total + (passOn ? platformFee ?? 0 : 0))} strong />
            {passOn ? <><PaymentRow label="Payment processing" value="Calculated by PayMongo" /><PaymentRow label="Final total" value="Shown on PayMongo" strong /></> : <PaymentRow label="Added at checkout" value="₱0.00" />}
          </dl>
          {passOn ? <p className={styles.finePrint}>PayMongo calculates the processing fee for your chosen method. Review the exact fee and final total on its secure checkout before you confirm payment.</p> : <p className={styles.finePrint}>{platformFee !== null ? `${formatPeso(platformFee)} in Taxes and fees is included in this price. ` : ""}PayMongo’s actual processing fee is deducted after payment. Neither fee increases your total.</p>}
        </section>
        {hostedPayMongo ? <HostedPaymentMethods key={registrationId} registrationId={registrationId} total={total} passOn={passOn} /> :
          <section className={styles.payMethods}>
            <h3>Pay with</h3>
            <p>Choose a payment method to continue.</p>
            <div className={styles.methodGrid} aria-label="Payment methods">
              {(["qrph", "gcash", "maya", "card"] as const).map((key) => {
                const label = PAY_METHODS.find((item) => item.key === key)?.label ?? key;
                return <button key={key} type="button" aria-pressed={method === key} onClick={() => setMethod(key)} className={styles.methodItem}><MethodLogo methodKey={key} /><span>{label}</span>{method === key ? <Check className={styles.methodSelected} size={16} aria-hidden="true" /> : null}</button>;
              })}
            </div>
          </section>}
      </div>
      {inclusions.length > 0 ? <section className={styles.inclusions}><h3>What&apos;s included</h3><ul>{inclusions.map((item, index) => <li key={index}><Check size={15} aria-hidden="true" />{item}</li>)}</ul></section> : null}
      <RefundNotice policy={reg.data.refundPolicy} retention={reg.data.refundFeeCents} />
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}
      <div className={styles.actions}><Button type="button" disabled={busy} onClick={pay}>{busy ? "Opening…" : passOn ? "Continue to checkout" : `Pay ${formatPeso(due ?? total)}`} <ArrowRight size={16} aria-hidden="true" /></Button></div>
      <p className={styles.securityNote}><Lock size={13} aria-hidden="true" /> Encrypted and secured by PayMongo</p>
    </RaceBib>
  );
}

const PROVIDER_METHODS = { qrph: "qrph", gcash: "gcash", paymaya: "maya", card: "card" } as const;

function HostedPaymentMethods({ registrationId, total, passOn }: { registrationId: string; total: number; passOn: boolean }) {
  const [inspection, setInspection] = useState<{ loading: boolean; methods: string[] | null }>({ loading: true, methods: null });
  useEffect(() => {
    let active = true;
    void inspectCheckoutMethods(registrationId).then((methods) => { if (active) setInspection({ loading: false, methods }); });
    return () => { active = false; };
  }, [registrationId]);

  const available = inspection.methods?.filter((method): method is keyof typeof PROVIDER_METHODS => method in PROVIDER_METHODS) ?? [];
  return <section className={styles.payMethods}>
    <h3>Available at checkout</h3>
    <p>{inspection.loading ? "Checking payment methods with PayMongo…" : available.length ? "These methods are enabled for this checkout. Choose one on PayMongo." : "PayMongo will show the methods available for this checkout."}</p>
    {available.length ? <div className={cn(styles.methodGrid, available.length === 1 && styles.singleMethod)} aria-label="Payment methods available on PayMongo">
      {available.map((method) => {
        const key = PROVIDER_METHODS[method];
        const label = PAY_METHODS.find((item) => item.key === key)?.label ?? key;
        return <span key={method} className={styles.methodItem}><MethodLogo methodKey={key} /><span>{label}</span></span>;
      })}
    </div> : null}
    {!passOn ? <p className={styles.finePrint}>The total stays {formatPeso(total)}. Processing and Race Pace fees come out of this price.</p> : null}
  </section>;
}

function PaymentRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className={cn(styles.reviewRow, strong && styles.reviewStrong)}><dt>{label}</dt><dd>{value}</dd></div>;
}
