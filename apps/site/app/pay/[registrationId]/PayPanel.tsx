"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Lock } from "lucide-react";
import { formatPeso } from "@race-pace/shared";
import { isRegistrationClosed } from "@/lib/eventStatus";
import { holdExpired } from "@/lib/holdExpiry";
import { useRegistration, createMethodCheckout } from "@/lib/registration";
import { checkoutErrorMessage } from "@/lib/errors";
import { PAY_METHODS, breakdown } from "@/lib/payment";
import { MethodLogo } from "@/components/PaymentLogos";
import { TicketStub } from "@/components/TicketStub";
import { RefundNotice } from "@/components/RefundNotice";
import { StepRail } from "@/components/StepRail";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <StepRail current={4} />

      <h1 className="mt-8 text-[28px] font-semibold tracking-[-0.6px] text-foreground">Payment</h1>
      <p className="mt-1.5 text-[14px] text-muted-foreground">
        Your slot is held while you pay — complete this to lock it in.
      </p>

      <div className="mt-6">
        <TicketStub
          eventName={reg.data.eventName}
          categoryLabel={reg.data.categoryLabel}
          amountLabel="Total due"
          amount={due}
        />
      </div>

      <dl className="mt-5 divide-y divide-divider overflow-hidden rounded-xl border border-border">
        <div className="flex justify-between px-5 py-3.5">
          <dt className="text-[14px] text-muted-foreground">Entry fee</dt>
          <dd className="text-[14px] font-semibold tabular-nums text-foreground">{formatPeso(entry)}</dd>
        </div>
        {addons > 0 ? (
          <div className="flex justify-between px-5 py-3.5">
            <dt className="text-[14px] text-muted-foreground">Add-ons</dt>
            <dd className="text-[14px] font-semibold tabular-nums text-foreground">+{formatPeso(addons)}</dd>
          </div>
        ) : null}
        {passOn && platformFee !== null && platformFee > 0 ? (
          <div className="flex justify-between px-5 py-3.5">
            <dt className="text-[14px] text-muted-foreground">Taxes and fees</dt>
            <dd className="text-[14px] font-semibold tabular-nums text-foreground">+{formatPeso(platformFee)}</dd>
          </div>
        ) : null}
        {passOn ? (
          <>
            <div className="flex justify-between px-5 py-3.5">
              <dt className="text-[14px] text-muted-foreground">Payment processing</dt>
              <dd className="text-[14px] text-muted-foreground">Calculated by PayMongo</dd>
            </div>
            <div className="flex justify-between bg-secondary px-5 py-3.5">
              <dt className="text-[14px] font-semibold text-foreground">Total to pay</dt>
              <dd className="text-[14px] text-muted-foreground">Shown on PayMongo</dd>
            </div>
          </>
        ) : (
          <div className="flex justify-between px-5 py-3.5">
            <dt className="text-[14px] text-muted-foreground">Added at checkout</dt>
            <dd className="text-[14px] font-semibold text-primary">₱0.00</dd>
          </div>
        )}
      </dl>
      {passOn ? (
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
          PayMongo calculates the processing fee for your chosen method. Review the exact fee and final total
          on its secure checkout before you confirm payment.
        </p>
      ) : null}
      {!passOn ? <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
        {platformFee !== null ? `${formatPeso(platformFee)} in Taxes and fees is included in this price. ` : ""}
        PayMongo’s actual processing fee is deducted after payment. Neither fee increases your total.
      </p> : null}

      {inclusions.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-[15px] font-semibold text-foreground">What&apos;s included</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {inclusions.map((item, i) => (
              <li key={i} className="flex items-center gap-2.5 text-[14px] text-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {item}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <RefundNotice policy={reg.data.refundPolicy} retention={reg.data.refundFeeCents} />

      {hostedPayMongo && !passOn ? <p className="mt-6 text-sm text-muted-foreground">Choose GCash, Maya or card on PayMongo. The total stays {formatPeso(total)}; processing and Race Pace fees come out of this price.</p> : null}
      {!hostedPayMongo && !passOn ? <><h2 className="mt-8 text-[11px] font-semibold uppercase tracking-[0.6px] text-muted-foreground">Pay with</h2>
      <div className="mt-3 flex flex-col gap-3">
        {PAY_METHODS.map((m) => (
          <button
            key={m.key}
            type="button"
            aria-pressed={method === m.key}
            onClick={() => setMethod(m.key)}
            className={cn(
              "flex items-center justify-between rounded-lg border-[1.5px] p-4 text-left transition-colors",
              method === m.key ? "border-primary bg-secondary" : "border-border hover:border-primary",
            )}
          >
            <span className="flex items-center gap-2.5">
              <MethodLogo methodKey={m.key} />
              <span className="text-[15px] font-semibold text-foreground">{m.label}</span>
            </span>
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px]",
                method === m.key ? "border-primary bg-primary" : "border-border",
              )}
            >
              {method === m.key ? <Check size={12} className="text-primary-foreground" /> : null}
            </span>
          </button>
        ))}
      </div></> : null}

      {error ? <p className="mt-5 text-[14px] text-destructive">{error}</p> : null}

      <Button
        type="button"
        disabled={busy}
        onClick={pay}
        className="mt-8 h-auto w-full rounded-pill py-4 text-[16px] font-semibold"
      >
        {busy ? "Opening…" : passOn ? "Continue to checkout" : `Pay ${formatPeso(due ?? total)}`}
      </Button>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-[13px] text-muted-foreground">
        <Lock size={13} /> Encrypted and secured by PayMongo
      </p>
    </div>
  );
}
