"use client";

import { useEffect, useRef, useState } from "react";
import { passportCompleteness, passportSchema, PASSPORT_GENDERS, SHIRT_SIZES, BLOOD_TYPES } from "@race-pace/shared";
import { createManagedPassport, listPassports, savePassport, type RunnerPassport } from "@/lib/passports";
import { ShippingAddress } from "./ShippingAddress";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const FIELDS = [
  ["first_name", "First name", "text"], ["last_name", "Last name", "text"],
  ["team_name", "Team name (optional)", "text"], ["date_of_birth", "Date of birth", "date"],
  ["contact_number", "Contact number", "tel"],
  ["emergency_contact_name", "Emergency contact name", "text"],
  ["emergency_contact_number", "Emergency contact number", "tel"],
  ["emergency_contact_relationship", "Relationship to emergency contact", "text"],
] as const;

export function PassportEditor({ userId, email, onSaved }: { userId: string; email?: string; onSaved?: (passport: RunnerPassport) => void }) {
  const [passports, setPassports] = useState<RunnerPassport[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const requestId = useRef<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const passport = passports.find((p) => p.id === selected);

  function choose(p: RunnerPassport) {
    setSelected(p.id);
    setValues(Object.fromEntries([...FIELDS.map(([key]) => key), "gender", "participant_email", "shirt_size", "blood_type", "shipping_barangay_code", "shipping_zip_code", "shipping_address_line"].map((key) => [key, String(p[key as keyof RunnerPassport] ?? "")])));
    setIssues({}); setError(""); setSaved(false);
  }

  useEffect(() => {
    let active = true;
    setLoading(true); setPassports([]); setSelected(""); setValues({}); requestId.current = null;
    listPassports().then((rows) => {
      if (!active) return;
      setPassports(rows);
      const own = rows.find((row) => row.claimed_user_id === userId);
      if (own) choose(own);
    }).catch((err: unknown) => { if (active) setError(err instanceof Error ? err.message : "Could not load Passports."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [userId]);

  async function add() {
    setBusy(true); setError("");
    try {
      requestId.current ??= crypto.randomUUID();
      await createManagedPassport(requestId.current);
      const rows = await listPassports();
      setPassports(rows);
      const created = rows.find((row) => row.id === requestId.current);
      if (!created) throw new Error("Could not load the new Passport. Please try again.");
      choose(created); requestId.current = null;
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create Passport."); }
    finally { setBusy(false); }
  }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaved(false); setError("");
    const result = passportSchema(today).safeParse(values);
    if (!result.success) {
      setIssues(Object.fromEntries(result.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
      setError("Please complete the highlighted Passport fields."); return;
    }
    setBusy(true); setIssues({});
    try {
      const updated = await savePassport(selected, result.data, today);
      setPassports((rows) => rows.map((row) => row.id === updated.id ? updated : row));
      choose(updated); setSaved(true); onSaved?.(updated);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save Passport."); }
    finally { setBusy(false); }
  }

  if (loading) return <p role="status">Loading Passports…</p>;
  return <section className="mt-6 space-y-5">
    <div className="space-y-2">
      <Label htmlFor="passport-picker">Whose Passport are you editing?</Label>
      <select id="passport-picker" className="w-full rounded-md border bg-background p-3" disabled={busy} value={selected} onChange={(event) => {
        const row = passports.find((p) => p.id === event.target.value); if (row) choose(row);
      }}>
        {!selected && <option value="">Choose a Passport</option>}
        {passports.map((p) => <option key={p.id} value={p.id}>{p.claimed_user_id === userId ? "My Passport" : [p.first_name, p.last_name].filter(Boolean).join(" ") || p.legacy_full_name || "New participant"}</option>)}
      </select>
      <Button type="button" variant="outline" disabled={busy} onClick={add}>Add someone else’s Passport</Button>
      <p className="text-sm text-muted-foreground">Help a runner complete their details with their permission. This does not create a login or reserve a race slot.</p>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {passport && <form onSubmit={save} className="space-y-4" noValidate>
      <p className="text-sm">{passportCompleteness(passport, today).complete ? "Required details complete" : "Complete the required details before registering."}</p>
      {passport.legacy_full_name && !passport.first_name && <p className="text-sm text-muted-foreground">Previously saved name: {passport.legacy_full_name}. Please enter the first and last names separately.</p>}
      <fieldset disabled={busy} className="space-y-4">
        {FIELDS.map(([key, label, type]) => <div key={key} className="space-y-1.5">
          <Label htmlFor={`passport-${key}`}>{label}</Label>
          <Input id={`passport-${key}`} type={type} value={values[key] ?? ""} max={type === "date" ? today : undefined}
            aria-invalid={!!issues[key]} aria-describedby={issues[key] ? `error-${key}` : undefined}
            onChange={(event) => { setValues((v) => ({ ...v, [key]: event.target.value })); setSaved(false); }} />
          {issues[key] && <p id={`error-${key}`} className="text-sm text-destructive">{issues[key]}</p>}
        </div>)}
        <p className="text-sm text-muted-foreground">A shared household or helper’s number is allowed. Enter the emergency contact’s number separately.</p>
        <div className="space-y-1.5">
          <Label htmlFor="passport-gender">Gender</Label>
          <select id="passport-gender" className="w-full rounded-md border bg-background p-3" value={values.gender ?? ""} aria-invalid={!!issues.gender} onChange={(event) => { setValues((v) => ({ ...v, gender: event.target.value })); setSaved(false); }}>
            <option value="">Select gender</option>{PASSPORT_GENDERS.map((gender) => <option key={gender}>{gender}</option>)}
          </select>
          {issues.gender && <p className="text-sm text-destructive">{issues.gender}</p>}
        </div>
        {passport.claimed_user_id === userId ? <p className="text-sm">Account email: {email || "See account settings"}</p> : <div className="space-y-1.5">
          <Label htmlFor="participant-email">Participant email (optional)</Label>
          <Input id="participant-email" type="email" value={values.participant_email ?? ""} onChange={(event) => { setValues((v) => ({ ...v, participant_email: event.target.value })); setSaved(false); }} />
          {issues.participant_email && <p className="text-sm text-destructive">{issues.participant_email}</p>}
        </div>}
        {([['shirt_size', 'Shirt size', SHIRT_SIZES], ['blood_type', 'Blood type (optional)', BLOOD_TYPES]] as const).map(([key, label, options]) => <div className="space-y-1.5" key={key}>
          <Label htmlFor={`passport-${key}`}>{label}</Label>
          <select id={`passport-${key}`} className="w-full rounded-md border bg-background p-3" value={values[key] ?? ""} onChange={(event) => { setValues((v) => ({ ...v, [key]: event.target.value })); setSaved(false); }}>
            <option value="">Not provided</option>{options.map((option) => <option key={option}>{option}</option>)}
          </select>
          {issues[key] && <p className="text-sm text-destructive">{issues[key]}</p>}
        </div>)}
        <ShippingAddress key={selected} values={values} onChange={(patch) => { setValues((v) => ({ ...v, ...patch })); setSaved(false); }} />
        {["shipping_barangay_code", "shipping_zip_code", "shipping_address_line"].map((key) => issues[key] ? <p role="alert" key={key} className="text-sm text-destructive">{issues[key]}</p> : null)}
        <Button type="submit">{busy ? "Saving…" : "Save Passport"}</Button>
      </fieldset>
      {saved && <p role="status">Passport saved.</p>}
    </form>}
  </section>;
}
