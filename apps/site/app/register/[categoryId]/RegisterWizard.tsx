"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Shirt, UserRound } from "lucide-react";
import {
  customDataSchema, isProfileKey, formatPeso, formatDateRange,
  SHIRT_SIZES, BLOOD_TYPES, GENDERS, parsePhotoUrl, framedImageStyle, type FormField, type PassportInput,
} from "@race-pace/shared";
import type { CategoryRow, AddonRow, FormFieldRow, EventRow } from "@/lib/events";
import { loadDraft, newDraft, saveDraft, clearDraft, type RegistrationDraft } from "@/lib/draft";
import { totalAmount, stepOneErrors, showSaveBack, WAIVER_TEXT } from "@/lib/wizard";
import { getProfile, upsertProfile, type Profile } from "@/lib/profile";
import { startCheckout, CheckoutError } from "@/lib/registration";
import { longDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PillSelect } from "@/components/PillSelect";
import { DynamicField } from "@/components/DynamicField";
import { RefundNotice } from "@/components/RefundNotice";
import { feeOn } from "@/lib/payment";
import { RaceBib, RaceBibHeading } from "@/components/registration/RaceBib";
import { cn } from "@/lib/utils";
import styles from "./RegisterWizard.module.css";

export function RegisterWizard({ userId, category, event, addons, formFields, passport, email, waiver, participantId, assisted = false }: {
  participantId?: string;
  assisted?: boolean;
  waiver?: { id: string; title: string; body: string } | null;
  userId: string;
  passport?: PassportInput;
  email?: string;
  category: CategoryRow;
  event: EventRow;
  addons: AddonRow[];
  formFields: FormFieldRow[];
}) {
  const router = useRouter();
  const draftKey = `${userId}:${category.id}${participantId ? `:${participantId}` : ""}`;
  const [draft, setDraft] = useState<RegistrationDraft>(() => {
    const saved = loadDraft(draftKey) ?? newDraft(category.id);
    return { ...saved, waiver: false };
  });
  useEffect(() => { setDraft(draft => ({ ...draft, waiver: false })); }, [waiver?.id]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [waiverOpen, setWaiverOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const prefilled = useRef(false);

  // Persist on every change — a refresh mid-flow must not lose progress, and
  // must not mint a new idempotency key.
  useEffect(() => { saveDraft(draftKey, draft); }, [draftKey, draft]);

  // Prefill from the Race Passport once, and never over a value the runner
  // already typed (a resumed draft wins).
  useEffect(() => {
    if (prefilled.current) return;
    prefilled.current = true;
    if (assisted) return;
    getProfile(userId).then((p) => {
      if (!p) return;
      setProfile(p);
      setDraft((d) => ({
        ...d,
        details: {
          full_name: d.details.full_name || (p.full_name ?? ""),
          bib_name: d.details.bib_name || (p.bib_name ?? ""),
          date_of_birth: d.details.date_of_birth || (p.date_of_birth ?? ""),
          gender: d.details.gender || (p.gender ?? ""),
          emergency_contact: d.details.emergency_contact || (p.emergency_contact ?? ""),
        },
        kit: {
          shirt_size: d.kit.shirt_size || (p.shirt_size ?? ""),
          blood_type: d.kit.blood_type || (p.blood_type ?? ""),
        },
      }));
    });
  }, [userId]);

  const eventQuestions = useMemo(() => formFields.filter((f) => !isProfileKey(f.key)), [formFields]);
  const requestedProfileKeys = useMemo(
    () => new Set(formFields.filter((f) => isProfileKey(f.key)).map((f) => f.key)),
    [formFields],
  );
  const total = totalAmount(category.base_price, addons, draft.addonIds);
  const passOn = event.feeMode === "pass_on";
  if (passOn && !event.commissionTerms) throw new Error("Race Pace fee terms are unavailable");
  const platformFee = event.commissionTerms ? feeOn(total, event.commissionTerms) : 0;
  const dateLabel = event.event_date ? formatDateRange(event.event_date, event.end_date, longDate) : null;
  const place = [event.place || event.venue || event.city_name, event.province_name || event.region_name].filter(Boolean).join(", ");
  const runnerName = passport ? `${passport.first_name} ${passport.last_name}` : draft.details.full_name || draft.details.bib_name || "Runner";
  const avatar = !assisted ? parsePhotoUrl(profile?.avatar_url) : null;

  const patch = (p: Partial<RegistrationDraft>) => setDraft((d) => ({ ...d, ...p }));
  const setDetail = (k: string, v: string) => setDraft((d) => ({ ...d, details: { ...d.details, [k]: v } }));
  const setKit = (k: string, v: string) => setDraft((d) => ({ ...d, kit: { ...d.kit, [k]: v } }));
  const setValue = (k: string, v: unknown) => setDraft((d) => ({ ...d, values: { ...d.values, [k]: v } }));

  // A required profile key must be validated by the step that RENDERS it.
  // Validating a step-1 field during step 2 leaves its error with nowhere to
  // appear: Continue silently does nothing and the runner is dead-ended with
  // no feedback.
  const STEP1_PROFILE_KEYS = ["bib_name", "date_of_birth", "emergency_contact", "gender"];
  const STEP2_PROFILE_KEYS = ["shirt_size", "blood_type"];

  const requiredProfileKeys = formFields.filter((f) => isProfileKey(f.key) && f.required).map((f) => f.key);
  // bib_name, date_of_birth and emergency_contact are always required on the
  // web — mobile can rely on the passport, a first-time web signup cannot.
  const REQUIRED_DETAILS = Array.from(new Set([
    "bib_name", "date_of_birth", "emergency_contact",
    ...requiredProfileKeys.filter((k) => STEP1_PROFILE_KEYS.includes(k)),
  ]));

  function next() {
    setFormError(null);
    if (draft.step === 1 && !passport) {
      const errs = stepOneErrors(draft.details, REQUIRED_DETAILS);
      setErrors(errs);
      if (Object.keys(errs).length) return;
    }
    if (draft.step === 2) {
      const eventFields: FormField[] = eventQuestions.map((f) => ({
        key: f.key, label: f.label, type: f.type, required: f.required, options: f.options ?? undefined,
      }));
      const parsed = customDataSchema(eventFields).safeParse(draft.values);
      if (!parsed.success) {
        const fieldErrors = parsed.error.flatten().fieldErrors;
        setErrors(Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, v?.[0] ?? "Invalid"])));
        return;
      }
      // Only the keys THIS step renders — step-1 keys were already validated above,
      // and re-checking them here would surface an error on a field the runner cannot see.
      // `||` not `??`: a key present-but-empty in `details` must still fall through to
      // `kit`, and `??` only falls through on null/undefined.
      const missing = requiredProfileKeys
        .filter((k) => STEP2_PROFILE_KEYS.includes(k))
        .filter((k) => !(draft.details[k] || draft.kit[k] || "").trim());
      if (missing.length) {
        setErrors(Object.fromEntries(missing.map((k) => [k, "This is required."])));
        return;
      }
      setErrors({});
    }
    patch({ step: draft.step + 1 });
  }

  async function submit() {
    if (!draft.waiver) { setFormError("Please accept the waiver to continue."); return; }
    setBusy(true);
    setFormError(null);
    try {
      if (draft.saveBack && !passport) {
        // Best-effort — a passport write must never block a registration.
        try {
          await upsertProfile({
            id: userId,
            ...(draft.details.full_name?.trim() ? { full_name: draft.details.full_name.trim() } : {}),
            bib_name: draft.details.bib_name?.trim() || null,
            date_of_birth: draft.details.date_of_birth || null,
            emergency_contact: draft.details.emergency_contact?.trim() || null,
            gender: draft.details.gender || null,
            shirt_size: draft.kit.shirt_size || null,
            blood_type: draft.kit.blood_type || null,
          });
        } catch { /* ignore */ }
      }

      const res = await startCheckout({
        event_id: category.event_id,
        category_id: category.id,
        addon_ids: draft.addonIds,
        custom_data: {
          ...draft.values,
          full_name: draft.details.full_name?.trim() || undefined,
          bib_name: draft.details.bib_name,
          date_of_birth: draft.details.date_of_birth,
          gender: draft.details.gender,
          shirt_size: draft.kit.shirt_size,
          blood_type: draft.kit.blood_type,
          emergency_contact: draft.details.emergency_contact,
          first_ultra: draft.firstUltra,
        },
        participant_passport_id: participantId,
        waiver_acceptance_method: assisted ? "participant_on_helper_device" : "signed_in_self",
        waiver_accepted: true,
        waiver_version_id: waiver?.id,
        idempotency_key: draft.idempotencyKey,
      });

      clearDraft(draftKey);
      router.replace(`/pay/${res.registration_id}`);
    } catch (e) {
      // Lost a race with another device/tab, or the event page's own gate was
      // stale — either way the server is the source of truth. Route straight
      // to the entry that already exists instead of stranding the runner on a
      // completed three-step form with a generic error string. Mirrors
      // apps/mobile/app/register/[categoryId].tsx's handling of the same 409.
      if (e instanceof CheckoutError && e.code === "already_registered" && e.registrationId) {
        clearDraft(draftKey);
        router.replace(`/pay/${e.registrationId}`);
        return;
      }
      if (e instanceof CheckoutError && e.code === "passport_incomplete") {
        router.push("/profile"); return;
      }
      setFormError(e instanceof Error ? e.message : "Registration failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <RaceBib
      step={draft.step as 1 | 2 | 3}
      eventName={event.name}
      categoryLabel={category.label}
      distanceKm={category.distance_km}
      dateLabel={dateLabel}
      organizer={event.org_name}
      place={place}
      amount={total + (passOn ? platformFee : 0)}
      amountLabel={passOn ? "Subtotal before processing" : draft.addonIds.length ? "Entry + extras" : "Entry fee"}
      note={passOn ? "Payment processing is calculated at PayMongo checkout." : "The amount shown includes all fees for this entry."}
    >
      {draft.step === 1 && passport ? <>
        <RaceBibHeading step={1} icon={<UserRound />} title={assisted ? "Check the participant’s Race Passport" : "Check your Race Passport"} description="Your ticket and emergency details will use this information." />
        <div className={styles.passportHeader}>
          <span className={styles.avatar}>
            {avatar ? <img src={avatar.src} alt={`${runnerName}'s profile photo`} style={framedImageStyle(avatar.framing)} /> : <span aria-hidden="true">{`${passport.first_name[0] ?? ""}${passport.last_name[0] ?? ""}`.toUpperCase()}</span>}
          </span>
          <span className={styles.runnerName}><strong>{runnerName}</strong><span>Race Passport ready</span></span>
          <span className={styles.readyBadge}><Check size={13} aria-hidden="true" /> Verified details</span>
        </div>
        <div className={styles.fieldGroups}>
          <section><h3>Runner identity</h3><dl className={styles.passportGrid}>
            <PassportField label="First name" value={passport.first_name} />
            <PassportField label="Last name" value={passport.last_name} />
            <PassportField label="Team name" value={passport.team_name || "None"} />
            <PassportField label="Date of birth" value={longDate(passport.date_of_birth)} />
            <PassportField label="Gender" value={passport.gender} />
            <PassportField label="Contact number" value={passport.contact_number} />
          </dl></section>
          <section><h3>Safety and booking</h3><dl className={styles.passportGrid}>
            <PassportField label="Emergency contact" value={passport.emergency_contact_name} />
            <PassportField label="Emergency number" value={passport.emergency_contact_number} />
            <PassportField label="Relationship" value={passport.emergency_contact_relationship} />
            <PassportField label="Booking email" value={email || ""} />
          </dl></section>
        </div>
        <Link href="/profile" className={styles.editLink}>Edit Race Passport <ArrowRight size={15} aria-hidden="true" /></Link>
      </> : null}

      {draft.step === 1 && !passport ? <>
        <RaceBibHeading step={1} icon={<UserRound />} title="Your details" description="Your ticket and emergency details will use this information." />
        <div className={styles.formFields}>
          <div className={styles.formField}><Label htmlFor="full_name">Full name</Label><Input id="full_name" value={draft.details.full_name ?? ""} onChange={(e) => setDetail("full_name", e.target.value)} /></div>
          <div className={styles.formField}><Label htmlFor="bib_name">Bib name *</Label><Input id="bib_name" value={draft.details.bib_name ?? ""} onChange={(e) => setDetail("bib_name", e.target.value)} aria-invalid={!!errors.bib_name} /><p>Printed on your race bib.</p>{errors.bib_name ? <p className={styles.error}>{errors.bib_name}</p> : null}</div>
          <div className={styles.formField}><Label htmlFor="date_of_birth">Date of birth *</Label><Input id="date_of_birth" type="date" value={draft.details.date_of_birth ?? ""} onChange={(e) => setDetail("date_of_birth", e.target.value)} aria-invalid={!!errors.date_of_birth} />{errors.date_of_birth ? <p className={styles.error}>{errors.date_of_birth}</p> : null}</div>
          <div className={styles.formField}><Label htmlFor="emergency_contact">Emergency contact *</Label><Input id="emergency_contact" value={draft.details.emergency_contact ?? ""} onChange={(e) => setDetail("emergency_contact", e.target.value)} placeholder="Name and mobile number" aria-invalid={!!errors.emergency_contact} />{errors.emergency_contact ? <p className={styles.error}>{errors.emergency_contact}</p> : null}</div>
        </div>
        {requestedProfileKeys.has("gender") ? <PillSelect label="GENDER" value={draft.details.gender ?? ""} options={GENDERS} onChange={(v) => setDetail("gender", v)} error={errors.gender} /> : null}
      </> : null}

      {draft.step === 2 ? <>
        <RaceBibHeading step={2} icon={<Shirt />} title="Make this entry yours" description="Choose your kit and answer the event questions." />
        <section className={styles.kitSection}>
          <div className={styles.sectionRow}><div><h3>Shirt size</h3><p>Choose the size you want on race day.</p></div>{requiredProfileKeys.includes("shirt_size") ? <span className={styles.required}>Required</span> : null}</div>
          <div className={styles.sizeGrid} role="group" aria-label="Shirt size">{SHIRT_SIZES.map((size) => <button key={size} type="button" className={styles.sizeButton} aria-pressed={draft.kit.shirt_size === size} onClick={() => setKit("shirt_size", size)}>{size}</button>)}</div>
          {errors.shirt_size ? <p className={styles.formError}>{errors.shirt_size}</p> : null}
        </section>
        {requestedProfileKeys.has("blood_type") ? <section className={styles.kitSection}><div className={styles.sectionRow}><div><h3>Blood type</h3><p>Used by the organizer for race-day preparation.</p></div>{requiredProfileKeys.includes("blood_type") ? <span className={styles.required}>Required</span> : null}</div><div className={styles.sizeGrid} role="group" aria-label="Blood type">{BLOOD_TYPES.map((bloodType) => <button key={bloodType} type="button" className={styles.sizeButton} aria-pressed={draft.kit.blood_type === bloodType} onClick={() => setKit("blood_type", bloodType)}>{bloodType}</button>)}</div>{errors.blood_type ? <p className={styles.formError}>{errors.blood_type}</p> : null}</section> : null}
        <section className={styles.kitSection}><div className={styles.sectionRow}><div><h3>Event question</h3><p>Your answer helps the organizers prepare.</p></div></div><div className={styles.choice}><Checkbox id="first_ultra" checked={draft.firstUltra} onCheckedChange={(c) => patch({ firstUltra: c === true })} /><span className={styles.choiceCopy}><Label htmlFor="first_ultra">First ultra at this distance?</Label><small>You can update this before you confirm.</small></span></div><div className={styles.dynamicFields}>{eventQuestions.map((f) => <DynamicField key={f.id} field={f} value={draft.values[f.key]} onChange={(v) => setValue(f.key, v)} error={errors[f.key]} />)}</div></section>
        {addons.length > 0 ? <section className={styles.kitSection}><div className={styles.sectionRow}><div><h3>Optional extras</h3><p>Only selected extras are added to your entry.</p></div></div>{addons.map((a) => { const on = draft.addonIds.includes(a.id); return <button key={a.id} type="button" aria-pressed={on} aria-label={a.name} onClick={() => patch({ addonIds: on ? draft.addonIds.filter((id) => id !== a.id) : [...draft.addonIds, a.id] })} className={styles.addon}><span className={styles.addonCheck}><Check size={15} aria-hidden="true" /></span><span className={styles.choiceCopy}><strong>{a.name}</strong></span><span className={styles.addonPrice}>+{formatPeso(a.price)}</span></button>; })}</section> : null}
        {!passport && showSaveBack(profile, { ...draft.details, ...draft.kit }) ? <div className={styles.choice}><Checkbox id="save_back" checked={draft.saveBack} onCheckedChange={(c) => patch({ saveBack: c === true })} /><Label htmlFor="save_back">Save these details to my profile</Label></div> : null}
      </> : null}

      {draft.step === 3 ? <>
        <RaceBibHeading step={3} icon={<Check />} title="One last look" description="Review the entry before your slot is reserved for payment." />
        <div className={styles.reviewGrid}>
          <section className={styles.reviewCard}><div className={styles.reviewTitle}><h3>Runner and kit</h3><Button type="button" variant="link" className={styles.miniLink} onClick={() => patch({ step: 1 })}>Edit details</Button></div><dl>
            {passport ? <><Row label="Runner" value={runnerName} /><Row label="Team name" value={passport.team_name || "None"} /></> : <Row label="Bib name" value={draft.details.bib_name} />}
            <Row label="Date of birth" value={longDate(passport?.date_of_birth ?? draft.details.date_of_birth)} />
            <Row label="Emergency contact" value={passport ? `${passport.emergency_contact_name} — ${passport.emergency_contact_number}` : draft.details.emergency_contact} />
            {draft.kit.shirt_size ? <Row label="Shirt size" value={draft.kit.shirt_size} /> : null}
            {draft.kit.blood_type ? <Row label="Blood type" value={draft.kit.blood_type} /> : null}
            <Row label="First ultra?" value={draft.firstUltra ? "Yes" : "No"} />
          </dl></section>
          <section className={styles.reviewCard}><div className={styles.reviewTitle}><h3>Entry cost</h3><Button type="button" variant="link" className={styles.miniLink} onClick={() => patch({ step: 2 })}>Edit kit</Button></div><dl>
            <Row label="Entry fee" value={formatPeso(category.base_price)} />
            {draft.addonIds.length ? <Row label="Add-ons" value={`+${formatPeso(total - category.base_price)}`} /> : null}
            {passOn && platformFee > 0 ? <Row label="Taxes and fees" value={formatPeso(platformFee)} /> : null}
            <Row label={passOn ? "Subtotal before payment processing" : "Total to pay"} value={formatPeso(total + (passOn ? platformFee : 0))} strong />
          </dl><p className={styles.finePrint}>{passOn ? "PayMongo calculates the processing fee and final total when you choose a payment method on its checkout page." : `This price includes ${formatPeso(platformFee)} in Taxes and fees. PayMongo’s actual processing fee is also deducted from this payment after capture. Neither fee is added to your total.`}</p></section>
        </div>
        <RefundNotice policy={event.refundPolicy} retention={event.refundFeeCents} />
        {assisted ? <p className="mt-6 rounded-lg bg-muted p-4 text-sm">Pass this device to {runnerName}. The participant must read and accept the waiver personally. You remain the booking contact.</p> : null}
        <div className={styles.waiverChoice}><Checkbox id="waiver" checked={draft.waiver} onCheckedChange={(c) => patch({ waiver: c === true })} /><div><Label htmlFor="waiver">{assisted ? `I, ${runnerName}, personally accept the event waiver and confirm I’m medically fit to take part.` : "I accept the event waiver and confirm I’m medically fit to take part."}</Label><button type="button" onClick={() => setWaiverOpen(true)}>Read event waiver</button></div></div>
      </> : null}

      {formError ? <p role="alert" className={styles.formError}>{formError}</p> : null}
      <div className={styles.actions}>
        {draft.step > 1 ? <Button type="button" variant="outline" onClick={() => patch({ step: draft.step - 1 })}><ArrowLeft size={16} aria-hidden="true" /> Back</Button> : null}
        {draft.step < 3 ? <Button type="button" onClick={next}>Continue <ArrowRight size={16} aria-hidden="true" /></Button> : <Button type="button" disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Continue to payment"} <ArrowRight size={16} aria-hidden="true" /></Button>}
      </div>

      <Dialog open={waiverOpen} onOpenChange={setWaiverOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{waiver?.title ?? "Event waiver"}</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto whitespace-pre-line text-[14px] leading-relaxed text-foreground">{waiver?.body ?? WAIVER_TEXT}</div>
          <Button type="button" className="mt-4 h-auto py-3" onClick={() => { patch({ waiver: true }); setWaiverOpen(false); }}>I accept</Button>
        </DialogContent>
      </Dialog>
    </RaceBib>
  );
}

function PassportField({ label, value }: { label: string; value: string | null | undefined }) {
  return <div className={styles.passportField}><dt>{label}</dt><dd>{value || "None"}</dd></div>;
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return <div className={cn(styles.reviewRow, strong && styles.reviewStrong)}><dt>{label}</dt><dd>{value}</dd></div>;
}
