"use client";

import { useEffect, useRef, useState } from "react";
import {
  BLOOD_TYPES,
  EMERGENCY_RELATIONSHIPS,
  PASSPORT_GENDERS,
  SHIRT_SIZES,
  passportCompleteness,
  passportSchema,
} from "@race-pace/shared";
import { Check, ChevronRight, MapPin, Phone, Plus, ShieldCheck, UserRound } from "lucide-react";
import { createManagedPassport, listPassports, savePassport, type RunnerPassport } from "@/lib/passports";
import { formatPhilippinePhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { ShippingAddress } from "./ShippingAddress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

const PERSONAL_FIELDS = [
  ["first_name", "First name", "text", true],
  ["last_name", "Last name", "text", true],
  ["team_name", "Team name", "text", false],
  ["date_of_birth", "Date of birth", "date", true],
] as const;

const CONTACT_FIELDS = [
  ["contact_number", "Contact number", "tel"],
  ["emergency_contact_name", "Emergency contact name", "text"],
  ["emergency_contact_number", "Emergency contact number", "tel"],
] as const;

const VALUE_KEYS = [
  ...PERSONAL_FIELDS.map(([key]) => key),
  ...CONTACT_FIELDS.map(([key]) => key),
  "emergency_contact_relationship",
  "gender",
  "participant_email",
  "shirt_size",
  "blood_type",
  "shipping_barangay_code",
  "shipping_zip_code",
  "shipping_address_line",
] as const;

const SELECT_CLASS = "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20";

const RELATIONSHIP_GROUPS = [
  { label: "Immediate family", values: EMERGENCY_RELATIONSHIPS.slice(0, 13) },
  { label: "Extended family", values: EMERGENCY_RELATIONSHIPS.slice(13, 25) },
  { label: "Support network", values: EMERGENCY_RELATIONSHIPS.slice(25) },
] as const;

function passportName(passport: RunnerPassport, userId: string) {
  if (passport.claimed_user_id === userId) return "My Passport";
  return [passport.first_name, passport.last_name].filter(Boolean).join(" ") || passport.legacy_full_name || "New participant";
}

export function PassportEditor({ userId, email, onSaved }: { userId: string; email?: string; onSaved?: (passport: RunnerPassport) => void }) {
  const [passports, setPassports] = useState<RunnerPassport[]>([]);
  const [selected, setSelected] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const requestId = useRef<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const passport = passports.find((row) => row.id === selected);
  const completion = passportCompleteness(values, today).complete;

  function change(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  function choose(row: RunnerPassport) {
    setSelected(row.id);
    setValues(Object.fromEntries(VALUE_KEYS.map((key) => {
      const value = String(row[key as keyof RunnerPassport] ?? "");
      return [key, key === "contact_number" || key === "emergency_contact_number" ? formatPhilippinePhone(value) : value];
    })));
    setIssues({});
    setError("");
    setSaved(false);
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setPassports([]);
    setSelected("");
    setValues({});
    requestId.current = null;
    listPassports().then((rows) => {
      if (!active) return;
      setPassports(rows);
      const own = rows.find((row) => row.claimed_user_id === userId);
      if (own) choose(own);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not load Passports.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [userId]);

  async function add() {
    setBusy(true);
    setError("");
    try {
      requestId.current ??= crypto.randomUUID();
      await createManagedPassport(requestId.current);
      const rows = await listPassports();
      setPassports(rows);
      const created = rows.find((row) => row.id === requestId.current);
      if (!created) throw new Error("Could not load the new Passport. Please try again.");
      choose(created);
      requestId.current = null;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create Passport.");
    } finally {
      setBusy(false);
    }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaved(false);
    setError("");
    const result = passportSchema(today).safeParse(values);
    if (!result.success) {
      setIssues(Object.fromEntries(result.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
      setError("Please complete the highlighted Passport fields.");
      return;
    }
    setBusy(true);
    setIssues({});
    try {
      const updated = await savePassport(selected, result.data, today);
      setPassports((rows) => rows.map((row) => row.id === updated.id ? updated : row));
      choose(updated);
      setSaved(true);
      onSaved?.(updated);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save Passport.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p role="status" className="mt-6 text-sm text-muted-foreground">Loading Passports…</p>;

  const relationship = values.emergency_contact_relationship ?? "";
  const legacyRelationship = relationship && !EMERGENCY_RELATIONSHIPS.includes(relationship as (typeof EMERGENCY_RELATIONSHIPS)[number])
    ? relationship
    : null;

  return (
    <section className="mt-6 grid items-start gap-6 lg:grid-cols-[19rem_minmax(0,1fr)]">
      <Card className="gap-0 py-0 lg:sticky lg:top-24">
        <CardHeader className="border-b border-divider py-6">
          <p className="font-eyebrow text-[10px] font-bold uppercase tracking-[2.4px] text-primary">Saved runners</p>
          <CardTitle className="font-display text-2xl font-black tracking-[-0.7px]">Race Passports</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 py-5">
          <div className="space-y-2" aria-label="Choose a Race Passport">
            {passports.map((row) => {
              const active = row.id === selected;
              const complete = passportCompleteness(row, today).complete;
              const name = passportName(row, userId);
              return (
                <button
                  key={row.id}
                  type="button"
                  disabled={busy}
                  aria-pressed={active}
                  aria-label={`Edit ${name}`}
                  onClick={() => choose(row)}
                  className={cn(
                    "flex min-h-16 w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                    active ? "border-primary bg-secondary" : "border-border bg-background hover:bg-accent",
                  )}
                >
                  <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg font-mono-race text-xs font-bold", active ? "bg-primary text-primary-foreground" : "bg-muted text-foreground")}>
                    {(row.first_name?.[0] ?? "R") + (row.last_name?.[0] ?? "P")}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{name}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{complete ? "Complete" : "Needs details"}</span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </button>
              );
            })}
          </div>
          <Button type="button" variant="outline" className="min-h-11 w-full border-dashed" disabled={busy} onClick={add}>
            <Plus aria-hidden /> Add someone else
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">Help another runner with permission. Their Passport does not create a login or reserve a race slot.</p>
          <Separator />
          <div className="flex gap-3 text-sm">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <div>
              <p className="font-semibold text-foreground">Private by design</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Details are shared only with events the runner enters.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div>
        {error ? <p role="alert" className="mb-4 rounded-lg border border-destructive/25 bg-destructive-tint px-4 py-3 text-sm text-destructive">{error}</p> : null}
        {passport ? (
          <Card className="gap-0 py-0">
            <CardHeader className="border-b border-divider py-6 sm:grid-cols-[1fr_auto]">
              <div>
                <p className="font-eyebrow text-[10px] font-bold uppercase tracking-[2.4px] text-primary">Editing</p>
                <CardTitle className="mt-2 font-display text-2xl font-black tracking-[-0.8px] sm:text-3xl">
                  {passportName(passport, userId)}
                </CardTitle>
                <CardDescription className="mt-2">Keep race-day details current. Required fields are marked.</CardDescription>
              </div>
              <Badge variant={completion ? "secondary" : "outline"} className="mt-3 h-7 sm:mt-0">
                {completion ? <Check aria-hidden /> : null}{completion ? "Ready" : "Needs details"}
              </Badge>
            </CardHeader>

            <form onSubmit={save} noValidate>
              <fieldset disabled={busy}>
                <details open className="group border-b border-divider">
                  <summary className="flex min-h-20 cursor-pointer list-none items-center gap-4 px-6 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"><UserRound aria-hidden /></span>
                    <span className="flex-1"><span className="block font-semibold">Personal details</span><span className="mt-1 block text-sm text-muted-foreground">Name, birthday and gender</span></span>
                    <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                  </summary>
                  <div className="grid gap-5 px-6 pb-6 sm:grid-cols-2">
                    {PERSONAL_FIELDS.map(([key, label, type, required]) => (
                      <div key={key} className="space-y-1.5">
                        <Label htmlFor={`passport-${key}`}>{label}{required ? " *" : ""}</Label>
                        <Input id={`passport-${key}`} type={type} value={values[key] ?? ""} max={type === "date" ? today : undefined} aria-invalid={!!issues[key]} aria-describedby={issues[key] ? `error-${key}` : undefined} onChange={(event) => change(key, event.target.value)} />
                        {issues[key] ? <p id={`error-${key}`} className="text-sm text-destructive">{issues[key]}</p> : null}
                      </div>
                    ))}
                    <div className="space-y-1.5">
                      <Label htmlFor="passport-gender">Gender *</Label>
                      <select id="passport-gender" className={SELECT_CLASS} value={values.gender ?? ""} aria-invalid={!!issues.gender} onChange={(event) => change("gender", event.target.value)}>
                        <option value="">Select gender</option>
                        {PASSPORT_GENDERS.map((gender) => <option key={gender}>{gender}</option>)}
                      </select>
                      {issues.gender ? <p className="text-sm text-destructive">{issues.gender}</p> : null}
                    </div>
                    {passport.claimed_user_id === userId ? (
                      <div className="rounded-lg bg-muted px-4 py-3 text-sm">
                        <span className="block text-xs font-semibold text-muted-foreground">Account email</span>
                        <span className="mt-1 block font-medium text-foreground">{email || "See account settings"}</span>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <Label htmlFor="participant-email">Participant email</Label>
                        <Input id="participant-email" type="email" value={values.participant_email ?? ""} onChange={(event) => change("participant_email", event.target.value)} />
                        <p className="text-xs text-muted-foreground">Optional and never treated as a verified login.</p>
                        {issues.participant_email ? <p className="text-sm text-destructive">{issues.participant_email}</p> : null}
                      </div>
                    )}
                    {passport.legacy_full_name && !passport.first_name ? <p className="text-sm text-muted-foreground sm:col-span-2">Previously saved name: {passport.legacy_full_name}. Enter the first and last names separately.</p> : null}
                  </div>
                </details>

                <details open className="group border-b border-divider">
                  <summary className="flex min-h-20 cursor-pointer list-none items-center gap-4 px-6 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"><Phone aria-hidden /></span>
                    <span className="flex-1"><span className="block font-semibold">Contact and safety</span><span className="mt-1 block text-sm text-muted-foreground">Reachable contacts for event day</span></span>
                    <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                  </summary>
                  <div className="grid gap-5 px-6 pb-6 sm:grid-cols-2">
                    {CONTACT_FIELDS.map(([key, label, type]) => (
                      <div key={key} className="space-y-1.5">
                        <Label htmlFor={`passport-${key}`}>{label} *</Label>
                        <Input id={`passport-${key}`} type={type} inputMode={type === "tel" ? "tel" : undefined} autoComplete={key === "contact_number" ? "tel" : undefined} value={values[key] ?? ""} maxLength={type === "tel" ? 17 : undefined} placeholder={type === "tel" ? "+63 917 555 0142" : undefined} aria-invalid={!!issues[key]} aria-describedby={issues[key] ? `error-${key}` : undefined} onChange={(event) => change(key, type === "tel" ? formatPhilippinePhone(event.target.value) : event.target.value)} />
                        {issues[key] ? <p id={`error-${key}`} className="text-sm text-destructive">{issues[key]}</p> : null}
                      </div>
                    ))}
                    <div className="space-y-1.5">
                      <Label htmlFor="passport-relationship">Relationship *</Label>
                      <select id="passport-relationship" className={SELECT_CLASS} value={relationship} aria-invalid={!!issues.emergency_contact_relationship} onChange={(event) => change("emergency_contact_relationship", event.target.value)}>
                        <option value="">Select relationship</option>
                        {legacyRelationship ? <option value={legacyRelationship}>{legacyRelationship} (saved)</option> : null}
                        {RELATIONSHIP_GROUPS.map((group) => <optgroup key={group.label} label={group.label}>{group.values.map((option) => <option key={option} value={option}>{option}</option>)}</optgroup>)}
                      </select>
                      {issues.emergency_contact_relationship ? <p className="text-sm text-destructive">{issues.emergency_contact_relationship}</p> : null}
                    </div>
                    {([['shirt_size', 'Shirt size', SHIRT_SIZES], ['blood_type', 'Blood type', BLOOD_TYPES]] as const).map(([key, label, options]) => (
                      <div className="space-y-1.5" key={key}>
                        <Label htmlFor={`passport-${key}`}>{label}</Label>
                        <select id={`passport-${key}`} className={SELECT_CLASS} value={values[key] ?? ""} onChange={(event) => change(key, event.target.value)}>
                          <option value="">Not provided</option>
                          {options.map((option) => <option key={option}>{option}</option>)}
                        </select>
                      </div>
                    ))}
                    <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">A shared household or helper number is allowed. Enter the emergency contact’s number separately.</p>
                  </div>
                </details>

                <details open className="group">
                  <summary className="flex min-h-20 cursor-pointer list-none items-center gap-4 px-6 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"><MapPin aria-hidden /></span>
                    <span className="flex-1"><span className="block font-semibold">Shipping address *</span><span className="mt-1 block text-sm text-muted-foreground">Required for your Race Passport</span></span>
                    <ChevronRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
                  </summary>
                  <div className="px-6 pb-6">
                    <ShippingAddress key={selected} values={values} onChange={(patch) => { setValues((current) => ({ ...current, ...patch })); setSaved(false); }} />
                    {["shipping_barangay_code", "shipping_zip_code", "shipping_address_line"].map((key) => issues[key] ? <p key={key} className="mt-2 text-sm text-destructive">{issues[key]}</p> : null)}
                  </div>
                </details>
              </fieldset>

              <div className="flex flex-col gap-3 border-t border-divider px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className={cn("size-2 rounded-full", completion ? "bg-primary" : "bg-amber")} aria-hidden />
                  {saved ? "Passport saved." : completion ? "All required details are ready to save." : "Complete the required fields before registering."}
                </p>
                <Button type="submit" size="lg" disabled={busy}>{busy ? "Saving…" : "Save Passport"}<ChevronRight aria-hidden /></Button>
              </div>
              {saved ? <p role="status" className="sr-only">Passport saved.</p> : null}
            </form>
          </Card>
        ) : null}
      </div>
    </section>
  );
}
