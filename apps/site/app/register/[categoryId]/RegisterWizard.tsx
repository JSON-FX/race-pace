"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  customDataSchema, isProfileKey, formatPeso, formatDateRange,
  SHIRT_SIZES, BLOOD_TYPES, GENDERS, type FormField,
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
import { StepRail } from "@/components/StepRail";
import { TicketStub } from "@/components/TicketStub";
import { cn } from "@/lib/utils";

export function RegisterWizard({ userId, category, event, addons, formFields }: {
  userId: string;
  category: CategoryRow;
  event: EventRow;
  addons: AddonRow[];
  formFields: FormFieldRow[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<RegistrationDraft>(() => loadDraft(category.id) ?? newDraft(category.id));
  const [profile, setProfile] = useState<Profile | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [waiverOpen, setWaiverOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const prefilled = useRef(false);

  // Persist on every change — a refresh mid-flow must not lose progress, and
  // must not mint a new idempotency key.
  useEffect(() => { saveDraft(category.id, draft); }, [category.id, draft]);

  // Prefill from the Race Passport once, and never over a value the runner
  // already typed (a resumed draft wins).
  useEffect(() => {
    if (prefilled.current) return;
    prefilled.current = true;
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
  const dateLabel = event.event_date ? formatDateRange(event.event_date, event.end_date, longDate) : null;
  const stubMeta = [dateLabel, event.org_name].filter(Boolean).join(" · ");

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
    if (draft.step === 1) {
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
      if (draft.saveBack) {
        // Best-effort — a passport write must never block a registration.
        try {
          await upsertProfile({
            id: userId,
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
          bib_name: draft.details.bib_name,
          date_of_birth: draft.details.date_of_birth,
          gender: draft.details.gender,
          shirt_size: draft.kit.shirt_size,
          blood_type: draft.kit.blood_type,
          emergency_contact: draft.details.emergency_contact,
          first_ultra: draft.firstUltra,
          ...draft.values,
        },
        waiver_accepted: true,
        idempotency_key: draft.idempotencyKey,
      });

      clearDraft(category.id);
      router.replace(`/pay/${res.registration_id}`);
    } catch (e) {
      // Lost a race with another device/tab, or the event page's own gate was
      // stale — either way the server is the source of truth. Route straight
      // to the entry that already exists instead of stranding the runner on a
      // completed three-step form with a generic error string. Mirrors
      // apps/mobile/app/register/[categoryId].tsx's handling of the same 409.
      if (e instanceof CheckoutError && e.code === "already_registered" && e.registrationId) {
        clearDraft(category.id);
        router.replace(`/pay/${e.registrationId}`);
        return;
      }
      setFormError(e instanceof Error ? e.message : "Registration failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <StepRail current={draft.step} />

      <div className="mt-8">
        <TicketStub
          eventName={event.name}
          categoryLabel={category.label}
          meta={stubMeta || undefined}
          amountLabel={draft.addonIds.length ? "Total" : "Entry fee"}
          amount={total}
        />
      </div>

      {draft.step === 1 ? (
        <section className="mt-8">
          <h2 className="font-display text-[26px] font-extrabold tracking-[-0.5px] text-foreground">Your details</h2>
          <div className="mt-6 flex flex-col gap-2">
            <Label htmlFor="full_name">Full name</Label>
            <Input id="full_name" value={draft.details.full_name ?? ""} onChange={(e) => setDetail("full_name", e.target.value)} />
          </div>
          <div className="mt-6 flex flex-col gap-2">
            <Label htmlFor="bib_name">Bib name *</Label>
            <Input id="bib_name" value={draft.details.bib_name ?? ""} onChange={(e) => setDetail("bib_name", e.target.value)} aria-invalid={!!errors.bib_name} />
            <p className="text-[13px] text-muted-foreground">Printed on your race bib.</p>
            {errors.bib_name ? <p className="text-[13px] text-destructive">{errors.bib_name}</p> : null}
          </div>
          <div className="mt-6 flex flex-col gap-2">
            <Label htmlFor="date_of_birth">Date of birth *</Label>
            <Input id="date_of_birth" type="date" value={draft.details.date_of_birth ?? ""} onChange={(e) => setDetail("date_of_birth", e.target.value)} aria-invalid={!!errors.date_of_birth} />
            {errors.date_of_birth ? <p className="text-[13px] text-destructive">{errors.date_of_birth}</p> : null}
          </div>
          <div className="mt-6 flex flex-col gap-2">
            <Label htmlFor="emergency_contact">Emergency contact *</Label>
            <Input id="emergency_contact" value={draft.details.emergency_contact ?? ""} onChange={(e) => setDetail("emergency_contact", e.target.value)} placeholder="Name and mobile number" aria-invalid={!!errors.emergency_contact} />
            {errors.emergency_contact ? <p className="text-[13px] text-destructive">{errors.emergency_contact}</p> : null}
          </div>
          {requestedProfileKeys.has("gender") ? (
            <PillSelect label="GENDER" value={draft.details.gender ?? ""} options={GENDERS} onChange={(v) => setDetail("gender", v)} error={errors.gender} />
          ) : null}
        </section>
      ) : null}

      {draft.step === 2 ? (
        <section className="mt-8">
          <h2 className="font-display text-[26px] font-extrabold tracking-[-0.5px] text-foreground">Kit &amp; extras</h2>
          <PillSelect label="SHIRT SIZE" value={draft.kit.shirt_size ?? ""} options={SHIRT_SIZES} onChange={(v) => setKit("shirt_size", v)} error={errors.shirt_size} />
          {requestedProfileKeys.has("blood_type") ? (
            <PillSelect label="BLOOD TYPE" value={draft.kit.blood_type ?? ""} options={BLOOD_TYPES} onChange={(v) => setKit("blood_type", v)} error={errors.blood_type} />
          ) : null}

          <div className="mt-6 flex items-center gap-3 rounded-lg border border-border p-4">
            <Checkbox id="first_ultra" checked={draft.firstUltra} onCheckedChange={(c) => patch({ firstUltra: c === true })} />
            <Label htmlFor="first_ultra" className="text-[14px]">First ultra at this distance?</Label>
          </div>

          {eventQuestions.map((f) => (
            <DynamicField key={f.id} field={f} value={draft.values[f.key]} onChange={(v) => setValue(f.key, v)} error={errors[f.key]} />
          ))}

          {addons.length > 0 ? (
            <>
              <h3 className="mt-10 text-[15px] font-semibold text-foreground">Add-ons</h3>
              <div className="mt-3 flex flex-col gap-3">
                {addons.map((a) => {
                  const on = draft.addonIds.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      aria-pressed={on}
                      aria-label={a.name}
                      onClick={() => patch({ addonIds: on ? draft.addonIds.filter((id) => id !== a.id) : [...draft.addonIds, a.id] })}
                      className={cn(
                        "flex items-center justify-between rounded-lg border p-4 text-left transition-colors",
                        on ? "border-primary bg-secondary" : "border-border hover:border-primary",
                      )}
                    >
                      <span className="text-[14px] font-medium text-foreground">{a.name}</span>
                      <span className="text-[14px] font-semibold text-primary">+{formatPeso(a.price)}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}

          {/* Merged: gender lives in `details`, shirt/blood in `kit`, and all
              three are what submit() writes back to the passport. */}
          {showSaveBack(profile, { ...draft.details, ...draft.kit }) ? (
            <div className="mt-6 flex items-center gap-3 rounded-lg border border-border p-4">
              <Checkbox id="save_back" checked={draft.saveBack} onCheckedChange={(c) => patch({ saveBack: c === true })} />
              <Label htmlFor="save_back" className="text-[14px]">Save these details to my profile</Label>
            </div>
          ) : null}
        </section>
      ) : null}

      {draft.step === 3 ? (
        <section className="mt-8">
          <h2 className="font-display text-[26px] font-extrabold tracking-[-0.5px] text-foreground">Review</h2>
          <dl className="mt-6 divide-y divide-divider rounded-xl border border-border">
            <Row label="Bib name" value={draft.details.bib_name} />
            <Row label="Date of birth" value={draft.details.date_of_birth} />
            <Row label="Emergency contact" value={draft.details.emergency_contact} />
            {draft.kit.shirt_size ? <Row label="Shirt size" value={draft.kit.shirt_size} /> : null}
            {draft.kit.blood_type ? <Row label="Blood type" value={draft.kit.blood_type} /> : null}
            <Row label="Entry fee" value={formatPeso(category.base_price)} />
            {draft.addonIds.length ? (
              <Row label="Add-ons" value={`+${formatPeso(total - category.base_price)}`} />
            ) : null}
            <Row label="Total" value={formatPeso(total)} strong />
          </dl>

          <div className="mt-6 flex items-start gap-3 rounded-lg border border-border p-4">
            <Checkbox id="waiver" checked={draft.waiver} onCheckedChange={(c) => patch({ waiver: c === true })} />
            <Label htmlFor="waiver" className="text-[13px] leading-relaxed">
              I accept the event{" "}
              <button type="button" className="font-semibold text-primary underline" onClick={() => setWaiverOpen(true)}>
                waiver
              </button>{" "}
              and confirm I&apos;m medically fit to take part.
            </Label>
          </div>
        </section>
      ) : null}

      {formError ? <p className="mt-6 text-[14px] text-destructive">{formError}</p> : null}

      <div className="mt-10 flex items-center gap-3">
        {draft.step > 1 ? (
          <Button type="button" variant="outline" className="h-auto rounded-pill px-6 py-4" onClick={() => patch({ step: draft.step - 1 })}>
            Back
          </Button>
        ) : null}
        {draft.step < 3 ? (
          <Button type="button" className="h-auto flex-1 rounded-pill py-4 text-[16px] font-semibold" onClick={next}>
            Continue
          </Button>
        ) : (
          <Button type="button" disabled={busy} className="h-auto flex-1 rounded-pill py-4 text-[16px] font-semibold" onClick={submit}>
            {busy ? "Submitting…" : `Register · ${formatPeso(total)}`}
          </Button>
        )}
      </div>

      <Dialog open={waiverOpen} onOpenChange={setWaiverOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Event waiver</DialogTitle></DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto whitespace-pre-line text-[14px] leading-relaxed text-foreground">
            {WAIVER_TEXT}
          </div>
          <Button type="button" className="mt-4 h-auto rounded-pill py-3" onClick={() => { patch({ waiver: true }); setWaiverOpen(false); }}>
            I accept
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5">
      <dt className="text-[14px] text-muted-foreground">{label}</dt>
      <dd className={cn("text-[14px] text-foreground", strong && "text-[16px] font-semibold")}>{value}</dd>
    </div>
  );
}
