"use client";


import { ArrowRight } from "lucide-react";
import { ChoiceGroup } from "@race-pace/ui";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";

import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DISCIPLINE_LABELS, type EventDiscipline } from "@race-pace/shared";
import { createClient } from "@/lib/supabase/client";
import { eventPublicPath, type EventRow } from "@/lib/events";
import { listPassports, type RunnerPassport } from "@/lib/passports";
import "./coming-soon.css";

type ExistingReservation = { id: string; status: string; quantity: number } | null;

function pesos(cents: number): string {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(cents / 100);
}

function dateLabel(iso: string | null | undefined): string {
  if (!iso) return "To be announced";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", day: "numeric", month: "long", year: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).format(new Date(iso)) + " PHT";
}

function shortDateLabel(iso: string | null | undefined): string {
  if (!iso) return "TO BE ANNOUNCED";
  const parts = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila", day: "numeric", month: "short", year: "numeric",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")} ${part("month")} ${part("year")}`.toUpperCase();
}

function ComingSoonGallery({ name, images }: { name: string; images: string[] }) {
  const [selected, setSelected] = useState(0);
  const [open, setOpen] = useState(false);
  const current = images[selected];
  const step = (delta: number) => setSelected((value) => (value + delta + images.length) % images.length);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!open) return;
      if (event.key === "ArrowLeft") step(-1);
      if (event.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [images.length, open]);

  if (!images.length) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}><section className="dossier-section dossier-gallery" aria-labelledby="coming-gallery-title">
      <div className="dossier-section-inner">
        <div className="dossier-gallery-heading">
          <div><p className="dossier-eyebrow">A LOOK AT THE EVENT</p><h2 id="coming-gallery-title">EVENT GALLERY</h2></div>
          <p>Explore the event images. Select a photo or open it full screen.</p>
        </div>
        <div className="dossier-gallery-stage">
          <DialogTrigger asChild><Button variant="ghost" type="button" className="dossier-gallery-open" aria-label={`Open event image ${selected + 1} full screen`}
            >
            <Image src={current} width={1536} height={1024} alt={`${name} event image ${selected + 1}`} />
            <span>VIEW FULL SCREEN ↗</span>
          </Button></DialogTrigger>
          {images.length > 1 ? (
            <div className="dossier-gallery-stage-controls">
              <Button variant="ghost" type="button" aria-label="Previous event image" onClick={() => step(-1)}>←</Button>
              <span>{String(selected + 1).padStart(2, "0")} / {String(images.length).padStart(2, "0")}</span>
              <Button variant="ghost" type="button" aria-label="Next event image" onClick={() => step(1)}>→</Button>
            </div>
          ) : null}
        </div>
        {images.length > 1 ? (
          <div className="dossier-gallery-thumbs" role="group" aria-label="Select event image">
            {images.map((url, index) => (
              <Button variant="ghost" key={`${url}-${index}`} type="button" aria-label={`Show event image ${index + 1}`}
                aria-pressed={index === selected} onClick={() => setSelected(index)}>
                <Image src={url} width={80} height={55} alt="" />
                <span>{String(index + 1).padStart(2, "0")} · Event image</span>
              </Button>
            ))}
          </div>
        ) : null}
      </div>
      <DialogContent showCloseButton={false} data-fullscreen="true" className="dossier-gallery-dialog inset-0 translate-x-0 translate-y-0 max-w-none sm:max-w-none w-screen h-dvh p-0">
        <DialogTitle className="sr-only">Event gallery full screen</DialogTitle><DialogDescription className="sr-only">Use the arrow keys to browse. Press Escape to close.</DialogDescription>
        <div className="dossier-gallery-dialog-inner">
          <div className="dossier-gallery-dialog-header">
            <span>{name.toUpperCase()} / EVENT GALLERY</span>
            <Button variant="ghost" type="button" aria-label="Close full-screen gallery" onClick={() => setOpen(false)}>CLOSE ×</Button>
          </div>
          <div className="dossier-gallery-dialog-stage">
            <Button variant="ghost" type="button" aria-label="Previous event image" onClick={() => step(-1)}>←</Button>
            <Button variant="ghost" type="button" id="dossier-gallery-full-image" aria-label="Close full-screen photo" onClick={() => setOpen(false)}>
              <Image src={current} width={1536} height={1024} alt={`${name} event image ${selected + 1}`} />
            </Button>
            <Button variant="ghost" type="button" aria-label="Next event image" onClick={() => step(1)}>→</Button>
          </div>
          <div className="dossier-gallery-dialog-footer">
            <span>{String(selected + 1).padStart(2, "0")} / {String(images.length).padStart(2, "0")}</span>
            <p>Select a photo below. Select the large image to close.</p>
            <div className="dossier-gallery-dialog-thumbs" role="group" aria-label="Select full-screen event image">
              {images.map((url, index) => (
                <Button variant="ghost" key={`${url}-${index}`} type="button" aria-label={`Show event image ${index + 1}`}
                  aria-pressed={index === selected} onClick={() => setSelected(index)}>
                  <Image src={url} width={94} height={66} alt="" />
                </Button>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </section></Dialog>
  );
}

const METHODS = [
  { id: "gcash", label: "GCash", logos: ["/payments/gcash.png"] },
  { id: "paymaya", label: "Maya", logos: ["/payments/maya.png"] },
  { id: "card", label: "Card", logos: ["/payments/visa.png", "/payments/mastercard.png"] },
  { id: "qrph", label: "QR Ph", logos: ["/payments/qr-ph.svg"] },
] as const;

function passportName(passport: RunnerPassport): string {
  return [passport.first_name, passport.last_name].filter(Boolean).join(" ").trim()
    || passport.legacy_full_name?.trim()
    || (passport.claimed_user_id ? "My Race Passport" : "Managed Race Passport");
}

export function ComingSoonEventPage({ event, userEmail, reservation, reservedPassports = [], reservationPayment = null }: {
  event: EventRow; userEmail: string | null; reservation: ExistingReservation;
  reservedPassports?: { participant_name: string; is_managed: boolean }[];
  reservationPayment?: { status: string; amount_cents: number; processor_fee_cents: number | null } | null;
}) {
  const [method, setMethod] = useState<(typeof METHODS)[number]["id"]>("gcash");
  const [busy, setBusy] = useState(false);
  const [reservationError, setReservationError] = useState<string | null>(null);
  const [notifyState, setNotifyState] = useState<string | null>(null);
  const [notifying, setNotifying] = useState(false);
  const [passports, setPassports] = useState<RunnerPassport[]>([]);
  const [selectedPassportIds, setSelectedPassportIds] = useState<string[]>([]);
  const [passportError, setPassportError] = useState<string | null>(null);
  const fee = event.reservation_fee_cents ?? 0;
  const platformFee = event.reservation_platform_fee_cents ?? 0;
  const placeCount = reservation?.quantity ?? Math.max(selectedPassportIds.length, 1);
  const deadline = dateLabel(event.reservation_deadline_at);
  const shortDeadline = shortDateLabel(event.reservation_deadline_at);
  const discipline = DISCIPLINE_LABELS[event.discipline as EventDiscipline] ?? event.discipline ?? "Race";
  const images = [event.hero_image_url, ...event.gallery].filter((url): url is string => !!url)
    .filter((url, index, all) => all.indexOf(url) === index);
  const canReserve = !!event.coming_soon_reserve_enabled && fee > 0 &&
    !!event.reservation_deadline_at && new Date(event.reservation_deadline_at).getTime() > Date.now();
  const signInHref = `/sign-in?next=${encodeURIComponent(eventPublicPath(event))}`;

  useEffect(() => {
    if (!userEmail || reservation || !event.coming_soon_reserve_enabled) return;
    let active = true;
    listPassports().then((items) => {
      if (!active) return;
      setPassports(items);
      const own = items.find((item) => item.claimed_user_id);
      if (own) setSelectedPassportIds([own.id]);
    }).catch(() => { if (active) setPassportError("Race Passports could not be loaded. Refresh and try again."); });
    return () => { active = false; };
  }, [userEmail, reservation, event.coming_soon_reserve_enabled]);

  function togglePassport(id: string) {
    setSelectedPassportIds((current) => current.includes(id)
      ? current.filter((value) => value !== id)
      : current.length < 10 ? [...current, id] : current);
  }

  async function reserve() {
    if (!userEmail || !canReserve || busy || !selectedPassportIds.length) return;
    setBusy(true);
    setReservationError(null);
    const db = createClient();
    const passportIds = [...selectedPassportIds].sort();
    const keyName = `coming-soon-reservation:${event.id}:${passportIds.join(",")}`;
    const storedKey = sessionStorage.getItem(keyName);
    let idempotencyKey = storedKey ?? crypto.randomUUID();
    if (storedKey) {
      const previous = await db.from("event_reservations").select("status")
        .eq("event_id", event.id).eq("idempotency_key", storedKey).maybeSingle();
      if (previous.data?.status === "expired") idempotencyKey = crypto.randomUUID();
    }
    sessionStorage.setItem(keyName, idempotencyKey);
    const { data, error } = await db.functions.invoke("reservation-checkout", {
      body: {
        event_id: event.id,
        method,
        idempotency_key: idempotencyKey,
        passport_ids: passportIds,
        return_url: `${window.location.origin}/reservations/callback`,
      },
    });
    const response = error && "context" in error && error.context instanceof Response
      ? await error.context.json().catch(() => null) : data;
    if (error || !data?.checkout_url) {
      if (["checkout_rejected", "checkout_expired", "reservation_not_payable"].includes(response?.error)) {
        sessionStorage.removeItem(keyName);
      }
      if (response?.error === "reservation_exists" && response.reservation_id) {
        window.location.assign(`/reservations/${response.reservation_id}`);
        return;
      }
      setReservationError(response?.error === "event_capacity_exhausted"
        ? "Reservations are unavailable right now. Try again later."
        : response?.error === "participant_already_reserved"
        ? "A selected Race Passport already has a place for this event. Review your reservation."
        : response?.error === "participant_not_accessible" || response?.error === "invalid_passports"
        ? "A selected Race Passport is unavailable to this account. Refresh and choose again."
        : response?.error === "payment_method_unavailable"
        ? "This payment method is unavailable for this merchant. Choose another method."
        : "The reservation checkout could not start. Please try again.");
      setBusy(false);
      return;
    }
    window.location.assign(data.checkout_url);
  }

  async function notify(eventForm: React.FormEvent<HTMLFormElement>) {
    eventForm.preventDefault();
    if (!userEmail || notifying) return;
    setNotifying(true);
    const db = createClient();
    const { data, error } = await db.functions.invoke("coming-soon-subscribe", { body: { event_id: event.id } });
    setNotifyState(error ? "We couldn't save your email. Please try again." : data?.already ? "You're already on the list." : "You're on the list. We'll email you when registration opens.");
    setNotifying(false);
  }

  return (
    <div className="dossier-page">
      <section className="dossier-hero" aria-label="Event introduction">
        {event.hero_image_url ? <Image src={event.hero_image_url} width={1536} height={1024} alt="" priority /> : null}
        <div className="dossier-overlay" />
        <div className="dossier-hero-inner">
          <div className="dossier-organizer">
            {event.org_logo_url ? <Image src={event.org_logo_url} width={88} height={88} alt="" /> : (
              <span className="dossier-organizer-fallback" aria-hidden="true">{event.org_name?.slice(0, 2).toUpperCase() ?? "RP"}</span>
            )}
            <div><span>HOSTED BY</span><p>{event.org_name ?? "Race Pace organizer"}</p><small>{discipline}</small></div>
          </div>
          <h1>{event.name}</h1>
          <p className="dossier-meta">COMING SOON <span>{event.event_date ?? "DATE TO BE ANNOUNCED"}</span></p>
          <dl className="dossier-stats">
            <div><dt>DISCIPLINE</dt><dd>{discipline}</dd></div>
            <div><dt>REGISTRATION</dt><dd>COMING SOON</dd></div>
            <div><dt>EVENT DATE</dt><dd>{event.event_date ?? "TO BE ANNOUNCED"}</dd></div>
            <div><dt>RESERVED ENTRY DUE</dt><dd>{event.coming_soon_reserve_enabled ? shortDeadline : "NOT APPLICABLE"}</dd></div>
          </dl>
          {canReserve ? <Button asChild variant="default" className="dossier-primary-cta"><a href="#dossier-reserve">Reserve now<ArrowRight aria-hidden /></a></Button>
            : event.coming_soon_notify_enabled ? <Button asChild variant="default" className="dossier-primary-cta"><a href="#dossier-notify">Notify me<ArrowRight aria-hidden /></a></Button> : null}
        </div>
      </section>
      <div className="dossier-content">
        <section className="dossier-description"><p>{event.description}</p></section>
        {event.coming_soon_reserve_enabled ? (
          <section className="dossier-section" id="dossier-reserve"><div className="dossier-section-inner">
            <h2>RESERVE YOUR PLACE</h2>
            <div className="dossier-reservation">
              <div className="dossier-reservation-main"><h3>EARLY RESERVATION</h3>
                <p>One event place for each selected Race Passport, held until the registration payment deadline.</p>
                {reservation ? <div className="dossier-passports dossier-passports-summary">
                  <h4>{reservation.quantity} reserved event {reservation.quantity === 1 ? "place" : "places"}</h4>
                  {reservedPassports.length ? <ul>{reservedPassports.map((passport, index) => <li key={`${passport.participant_name}-${index}`}>
                    <strong>{passport.participant_name}</strong><span>{passport.is_managed ? "Managed Passport" : "Your Passport"}</span>
                  </li>)}</ul> : <p>Your reservation covers {reservation.quantity} {reservation.quantity === 1 ? "Passport" : "Passports"}. View the reservation for details.</p>}
                </div> : userEmail ? <fieldset className="dossier-passports">
                  <legend>Choose who to reserve for</legend>
                  <p className="dossier-passport-help">Your Passport starts selected. Leave managed Passports unchecked to reserve only for yourself. Each selected Passport adds one event place and one reservation fee.</p>
                  {passportError ? <Alert role="alert"><AlertDescription>{passportError}</AlertDescription></Alert> : null}
                  {!passportError && !passports.length ? <p>Loading your Race Passports…</p> : null}
                  {passports.map((passport) => <Label className="dossier-passport" key={passport.id}>
                    <Checkbox  checked={selectedPassportIds.includes(passport.id)}
                      disabled={!selectedPassportIds.includes(passport.id) && selectedPassportIds.length >= 10}
                      onCheckedChange={() => togglePassport(passport.id)} />
                    <span><strong>{passportName(passport)}</strong><small>{passport.claimed_user_id ? "Your Passport" : "Managed Passport"}</small></span>
                  </Label>)}
                  {passports.length ? <p>{selectedPassportIds.length} selected · {selectedPassportIds.length} event {selectedPassportIds.length === 1 ? "place" : "places"}</p> : null}
                </fieldset> : null}
                {!reservation ? <ChoiceGroup label="Payment method" name="reservation-method" value={method}
                  onValueChange={setMethod} className="dossier-method-grid" options={METHODS.map(option => ({ value: option.id,
                    label: <><span className={`dossier-method-art${option.id === "card" ? " dossier-card-art" : ""}`}>
                      {option.logos.map(logo => <Image key={logo} src={logo} width={54} height={34} alt="" />)}
                    </span><span>{option.label}</span></> }))} /> : null}
              </div>
              <div className="dossier-reservation-right">
                <strong>{reservationPayment?.status === "paid" ? pesos(reservationPayment.amount_cents)
                  : pesos((fee + platformFee) * placeCount)}
                  {reservationPayment?.status === "paid" ? <span className="dossier-plus-fee"> paid in full</span>
                    : <span className="dossier-plus-fee"> + PayMongo fee</span>}
                </strong>
                <small>No refunds for the reservation fee.</small>
                {reservation ? <Button asChild variant="default"><Link className="dossier-button" href={`/reservations/${reservation.id}`}>
                  {reservation.status === "paid" ? "View reservation" : "Continue reservation"}</Link></Button>
                : !userEmail ? <Button asChild variant="default"><Link className="dossier-button" href={signInHref}>Sign in to reserve</Link></Button>
                : <Button variant="default" type="button" className="dossier-button" disabled={!canReserve || busy || !selectedPassportIds.length} onClick={reserve}>
                  {busy ? "Opening checkout…" : canReserve ? "Reserve now" : "Reservations paused"}
                </Button>}
              </div>
            </div>
            {reservationError ? <Alert variant="destructive" role="alert" className="dossier-action-error"><AlertDescription>{reservationError}</AlertDescription></Alert> : null}
            <dl className="dossier-fees">
              <div><dt>RESERVATION FEE{placeCount > 1 ? ` × ${placeCount} Passports` : ""}</dt><dd>{pesos(fee * placeCount)}</dd></div>
              <div><dt>PLATFORM FEES{placeCount > 1 ? ` × ${placeCount} Passports` : ""}</dt><dd>{pesos(platformFee * placeCount)}</dd></div>
              <div><dt>PAYMONGO FEE</dt><dd>{reservationPayment?.status === "paid" && reservationPayment.processor_fee_cents !== null
                ? pesos(reservationPayment.processor_fee_cents) : "Calculated at checkout"}</dd></div>
            </dl>
            {!reservationPayment || reservationPayment.status !== "paid" ? <p className="dossier-fee-note">PayMongo shows the actual processing fee and final charge for your payment method before you pay.</p> : null}
            <p className="dossier-term"><strong>No refunds for the reservation fee.</strong> Complete registration and secure payment by {deadline}. Otherwise, the reservation expires and its place returns to event inventory. The fee is separate from the later registration price. Choose an available category when registration opens.</p>
          </div></section>
        ) : null}
        <ComingSoonGallery name={event.name} images={images} />
        <section className="dossier-section"><div className="dossier-section-inner">
          <p className="dossier-eyebrow">KNOW BEFORE YOU GO</p><h2>THE ESSENTIALS</h2>
          <dl className="dossier-essentials">
            <div><dt>EVENT DATE</dt><dd>{event.event_date ?? "To be announced"}</dd></div>
            <div><dt>DISCIPLINE</dt><dd>{discipline}</dd></div>
            <div><dt>ENTRY PAYMENT DEADLINE</dt><dd>{event.coming_soon_reserve_enabled ? deadline : "Not applicable"}</dd></div>
            <div><dt>REGISTRATION</dt><dd>Opens later</dd></div>
          </dl>
        </div></section>
        {event.coming_soon_notify_enabled ? <section className="dossier-section dossier-email" id="dossier-notify"><div className="dossier-section-inner">
          <p className="dossier-eyebrow">WAIT FOR THE OPENING</p><h2>GET THE NOTICE</h2>
          <p>Get one email when registration opens.</p>
          {userEmail ? <form className="dossier-notify" onSubmit={notify}>
            <Label htmlFor="dossier-email">Email address</Label>
            <div><Input id="dossier-email" type="email" value={userEmail} readOnly /><Button variant="default" type="submit" disabled={notifying}>{notifying ? "Saving…" : "Notify me"}</Button></div>
            <p role="status" aria-live="polite">{notifyState}</p>
          </form> : <Button asChild variant="default"><Link className="dossier-button" href={signInHref}>Sign in to get the notice</Link></Button>}
        </div></section> : null}
        {canReserve ? <section className="dossier-end"><div><h2>STILL READING?<br />RESERVE.</h2><Button asChild variant="default" className="dossier-primary-cta dossier-end-cta"><a href="#dossier-reserve">Reserve now<ArrowRight aria-hidden /></a></Button></div></section> : null}
      </div>
    </div>
  );
}
