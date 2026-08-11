"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Lock } from "lucide-react";
import { formatPeso } from "@race-pace/shared";
import { isRegistrationClosed } from "@/lib/eventStatus";
import { holdExpired } from "@/lib/holdExpiry";
import { useRegistration, createMethodCheckout } from "@/lib/registration";
import { PAY_METHODS, breakdown } from "@/lib/payment";
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

  // The organizer can cancel while this page is open — the query polls, so the
  // status can flip under the runner. The server page redirects on load; this
  // covers the live case. Critical because `reg.data.checkoutUrl` holds a
  // PayMongo session created while the event was open and still chargeable.
  const eventClosed = isRegistrationClosed(reg.data.eventStatus ?? "");
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
    // Only fall back to the session created at registration when the event is
    // still open. createMethodCheckout returns null for ANY failure — including
    // the server's `registration_closed` 409 — so without this guard a
    // cancelled race would quietly charge the stored session anyway.
    const url = scoped ?? (isRegistrationClosed(reg.data!.eventStatus ?? "") ? null : reg.data!.checkoutUrl);
    if (!url) {
      setBusy(false);
      setError("No checkout link is available. Go back and try registering again.");
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
          amount={total}
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
        <div className="flex justify-between px-5 py-3.5">
          <dt className="text-[14px] text-muted-foreground">Booking fee</dt>
          <dd className="text-[14px] font-semibold text-primary">Free</dd>
        </div>
      </dl>

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
        {busy ? "Opening…" : `Pay ${formatPeso(total)}`}
      </Button>
      <p className="mt-3 flex items-center justify-center gap-1.5 text-[13px] text-muted-foreground">
        <Lock size={13} /> Encrypted and secured by PayMongo
      </p>
    </div>
  );
}
