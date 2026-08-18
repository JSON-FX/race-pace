"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Lock } from "lucide-react";
import { formatPeso } from "@race-pace/shared";
import { isRegistrationClosed } from "@/lib/eventStatus";
import { holdExpired } from "@/lib/holdExpiry";
import { useRegistration, useProcessorRate, createMethodCheckout } from "@/lib/registration";
import { checkoutErrorMessage } from "@/lib/errors";
import { PAY_METHODS, breakdown, feeOn, passOnLines } from "@/lib/payment";
import { MethodLogo } from "@/components/PaymentLogos";
import { TicketStub } from "@/components/TicketStub";
import { StepRail } from "@/components/StepRail";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PayPanel({ registrationId }: { registrationId: string }) {
  const reg = useRegistration(registrationId);
  const [method, setMethod] = useState("gcash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keyed on the method in state, so the processing line re-prices the instant
  // the runner picks a different one — which is the entire reason this lives in
  // the client rather than arriving as a prop from the server page, where it
  // would be frozen at whatever method was current at render.
  //
  // Absorb-mode orgs never read the rate card at all: the processing cost comes
  // out of the organizer's share there, so it is not merely unused on this
  // screen, it is somebody else's number.
  const rate = useProcessorRate(method, { enabled: reg.data?.feeMode === "pass_on" });

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

  const total = reg.data.total_amount;
  const { entry, addons } = breakdown(total, reg.data.basePrice);
  const inclusions = reg.data.inclusions ?? [];

  // In pass-on mode the runner covers the platform's commission and the
  // processor's cut, so the amount they are charged is NOT the sticker price —
  // it is the grossed-up total, and every line of it belongs on screen.
  //
  // The commission is struck on `total`, the base the organizer priced, exactly
  // as payment-session strikes it. Striking it on the grossed-up figure would
  // compound the two fees against each other and quietly change the org's terms.
  //
  // DISPLAY ONLY: payment-session recomputes all of this server-side when the
  // runner actually pays. `lines` stays null while the rate card has not
  // answered (and if it has no current offered row for this method), because a
  // breakdown drawn without a rate would be an invented one.
  const lines =
    reg.data.feeMode === "pass_on" && rate.data
      ? passOnLines(total, feeOn(total, reg.data.feeTerms), rate.data)
      : null;
  // A free pass-on entry grosses up to nothing, so `lines` is a truthy object of
  // zeros. There is no fee to itemise or explain there, and a "Total to pay
  // ₱0.00" line under an "Entry fee ₱0.00" line is the same number said twice.
  const hasFees = !!lines && (lines.platformFee > 0 || lines.processorFee > 0);
  // WHAT THE RUNNER WILL BE CHARGED — or null when that is not known yet.
  //
  // In pass-on mode the sticker price is NOT it, so falling back to `total`
  // would print a number nobody will be billed, on the stub and on a live Pay
  // button. That is the exact deception this screen exists to remove, and it is
  // not an exotic edge: the rate query cannot even START until `reg` resolves
  // (it is gated on feeMode), so EVERY pass-on page load renders once with no
  // rate, and so does every first switch to a method whose rate is not cached.
  //
  // It is not necessarily transient either, and "no rate here" does not imply
  // "no rate there": this screen filters the rate card on `offered` and
  // `processor_rate_at` does not (see fetchProcessorRate), so a rate correction
  // that forgets the flag leaves the client with nothing to quote while the
  // server charges the grossed-up total quite happily. Printing the sticker
  // price in that state would be a wrong number, persistently.
  const due = lines ? lines.total : reg.data.feeMode === "pass_on" ? null : total;

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
  // and its stored PayMongo session can still be young enough to charge. So
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

  async function pay() {
    setBusy(true);
    setError(null);
    // Remember which registration is in flight, so /pay/callback can recover
    // it if PayMongo drops the rid from the return URL.
    sessionStorage.setItem("rp:paying", registrationId);

    const scoped = await createMethodCheckout(registrationId, method);
    // Only fall back to the session created at registration when nothing has
    // said not to. `createMethodCheckout` mints no URL for ANY failure —
    // including the server's own 409s — so each thing that must not be paid for
    // needs naming here, or the stored session quietly charges anyway.
    //
    //  - the event closed: mirrored client-side, as it always was.
    //  - `scoped.code === "org_suspended"`: the SERVER's answer, and the only
    //    fresh fact available at the moment of the tap. This query has no
    //    refetch interval, so `orgIsActive` below can be minutes stale; a
    //    suspension that lands between render and tap is caught here and
    //    nowhere else.
    //  - `!reg.data!.orgIsActive`: belt and braces. It is unreachable while the
    //    `orgSuspended` early return above stands — no Pay button exists to tap
    //    — and it is kept precisely so that a refactor which moves or drops
    //    that early return does not silently reopen the fallback. It is not
    //    claimed to be doing work today.
    const url =
      scoped.url ??
      (isRegistrationClosed(reg.data!.eventStatus ?? "", reg.data!.eventRegistrationClosesAt)
        || scoped.code === "org_suspended"
        || !reg.data!.orgIsActive
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
        {hasFees && lines ? (
          <>
            {/* Zero lines are skipped, exactly as payment-session skips them
                when it builds the hosted checkout's line items — a ₱0.00 row is
                noise, and skipping only zeros keeps what is shown summing to
                what is charged. */}
            {lines.platformFee > 0 ? (
              <div className="flex justify-between px-5 py-3.5">
                <dt className="text-[14px] text-muted-foreground">Race Pace service fee</dt>
                <dd className="text-[14px] font-semibold tabular-nums text-foreground">
                  +{formatPeso(lines.platformFee)}
                </dd>
              </div>
            ) : null}
            {lines.processorFee > 0 ? (
              <div className="flex justify-between px-5 py-3.5">
                <dt className="text-[14px] text-muted-foreground">Payment processing</dt>
                <dd className="text-[14px] font-semibold tabular-nums text-foreground">
                  +{formatPeso(lines.processorFee)}
                </dd>
              </div>
            ) : null}
            <div className="flex justify-between bg-secondary px-5 py-3.5">
              <dt className="text-[14px] font-semibold text-foreground">Total to pay</dt>
              <dd className="text-[14px] font-bold tabular-nums text-foreground">{formatPeso(lines.total)}</dd>
            </div>
          </>
        ) : null}
        {/* Absorb mode, unchanged: the booking fee really is free to this
            runner, because the organizer is carrying it. Gated on the MODE
            rather than on `lines` so a pass-on org shows nothing here — "Free"
            would be a claim about fees this runner is about to be charged. */}
        {reg.data.feeMode === "absorb" ? (
          <div className="flex justify-between px-5 py-3.5">
            <dt className="text-[14px] text-muted-foreground">Booking fee</dt>
            <dd className="text-[14px] font-semibold text-primary">Free</dd>
          </div>
        ) : null}
        {/* Pass-on, but the rate card has not answered: say so, rather than
            print a total that is either unknown or wrong. The runner still sees
            the itemised figure before they confirm — PayMongo's hosted page
            lists it — which is what makes this an honest thing to say. */}
        {!lines && reg.data.feeMode === "pass_on" ? (
          <div className="flex justify-between px-5 py-3.5">
            <dt className="text-[14px] text-muted-foreground">Total to pay</dt>
            <dd className="text-[14px] text-muted-foreground">Shown at checkout</dd>
          </div>
        ) : null}
      </dl>
      {hasFees ? (
        <p className="mt-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
          This race passes the service and payment-processing costs on at checkout. The processing
          amount depends on how you pay, so it updates when you change method below.
        </p>
      ) : null}

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

      <h2 className="mt-8 text-[11px] font-semibold uppercase tracking-[0.6px] text-muted-foreground">Pay with</h2>
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
      </div>

      {error ? <p className="mt-5 text-[14px] text-destructive">{error}</p> : null}

      <Button
        type="button"
        disabled={busy}
        onClick={pay}
        className="mt-8 h-auto w-full rounded-pill py-4 text-[16px] font-semibold"
      >
        {/* No amount on the label when there is none to stand behind. The
            button stays ENABLED: the server may be perfectly able to price this
            charge even when the client could not (different rate-card
            predicates), and disabling would strand a runner who can otherwise
            pay — with PayMongo's own page itemising the total before they
            confirm. */}
        {busy ? "Opening…" : due === null ? "Pay" : `Pay ${formatPeso(due)}`}
      </Button>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-[13px] text-muted-foreground">
        <Lock size={13} /> Encrypted and secured by PayMongo
      </p>
    </div>
  );
}
