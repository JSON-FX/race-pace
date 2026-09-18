"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { customDataSchema, formatPeso, isProfileKey, passportSchema, SHIRT_SIZES, type GroupReservationInput } from "@race-pace/shared";
import type { AddonRow, CategoryRow, EventRow, FormFieldRow } from "@/lib/events";
import { assertGroupSelection, GroupCheckoutError, reserveGroup } from "@/lib/groupCheckout";
import { DynamicField } from "@/components/DynamicField";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export type GroupPassport = {
  id: string; claimed_user_id: string | null; first_name: string | null; last_name: string | null;
  shirt_size: string | null; blood_type: string | null; team_name: string | null; date_of_birth: string | null; gender: string | null;
  contact_number: string | null; emergency_contact_name: string | null;
  emergency_contact_number: string | null; emergency_contact_relationship: string | null;
  shipping_barangay_code: string | null; shipping_zip_code: string | null; shipping_address_line: string | null;
};

type Line = { addonIds: string[]; shirtSize: string; values: Record<string, unknown>; accepted: boolean };
const emptyLine = (): Line => ({ addonIds: [], shirtSize: "", values: {}, accepted: false });

export function GroupRegister({ userId, category, event, passports, addons, fields, waiver }: {
  userId: string; category: CategoryRow; event: EventRow; passports: GroupPassport[];
  addons: AddonRow[]; fields: FormFieldRow[]; waiver: { id: string; title: string; body: string };
}) {
  const router = useRouter();
  const storageKey = `rp:group:${userId}:${category.id}`;
  const [key, setKey] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const eventFields = useMemo(() => fields.filter(f => !isProfileKey(f.key)), [fields]);
  const available = Math.max(0, category.slots_total - category.slots_taken);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as { key?: string; selected?: string[]; lines?: Record<string, Line> } | null;
      setKey(saved?.key ?? crypto.randomUUID());
      setSelected((saved?.selected ?? []).filter(id => passports.some(p => p.id === id)));
      setLines(Object.fromEntries(Object.entries(saved?.lines ?? {}).map(([id, line]) => [id, { ...line, accepted: false }])));
    } catch { setKey(crypto.randomUUID()); }
    setReady(true);
  }, [storageKey, passports]);

  useEffect(() => {
    if (!ready || !key) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ key, selected, lines: Object.fromEntries(Object.entries(lines).map(([id, line]) => [id, { ...line, accepted: false }])) })); }
    catch { /* Private browsing can deny storage; the current tab still works. */ }
  }, [storageKey, key, selected, lines, ready]);

  function toggle(id: string) {
    setError(null);
    setSelected(current => current.includes(id) ? current.filter(value => value !== id) : [...current, id]);
    setLines(current => ({ ...current, [id]: { ...(current[id] ?? emptyLine()), accepted: false } }));
  }
  function updateLine(id: string, patch: Partial<Line>) {
    setLines(current => ({ ...current, [id]: { ...(current[id] ?? emptyLine()), ...patch, accepted: false } }));
  }
  const total = selected.reduce((sum, id) => sum + category.base_price + (lines[id]?.addonIds ?? []).reduce((amount, addonId) => amount + (addons.find(a => a.id === addonId)?.price ?? 0), 0), 0);

  async function submit() {
    setError(null);
    try {
      assertGroupSelection(selected, available);
      if (!key) throw new GroupCheckoutError("checkout_not_ready");
      if (total <= 0) throw new GroupCheckoutError("free_group_checkout_unavailable");
      const definitions = eventFields.map(f => ({ key: f.key, label: f.label, type: f.type, required: f.required, options: f.options ?? undefined }));
      const participants: GroupReservationInput["participants"] = selected.map(id => {
        const passport = passports.find(p => p.id === id)!;
        const line = lines[id] ?? emptyLine();
        if (!passportSchema(new Date().toISOString().slice(0, 10)).safeParse(passport).success) throw new GroupCheckoutError("passport_incomplete", id);
        if (!line.accepted) throw new GroupCheckoutError("participant_acceptance_required", id);
        const parsed = customDataSchema(definitions).safeParse(line.values);
        if (!parsed.success || eventFields.some(f => f.required && (line.values[f.key] == null || String(line.values[f.key]).trim() === ""))) {
          throw new GroupCheckoutError("invalid_custom_data", id);
        }
        if (fields.some(f => f.required && isProfileKey(f.key) && f.key !== "bib_name" &&
          !(f.key === "shirt_size" ? line.shirtSize || passport.shirt_size : (passport as unknown as Record<string, unknown>)[f.key]))) {
          throw new GroupCheckoutError("required_passport_field_missing", id);
        }
        return {
          participant_passport_id: id,
          addon_ids: line.addonIds,
          ...(line.shirtSize ? { shirt_size: line.shirtSize as (typeof SHIRT_SIZES)[number] } : {}),
          custom_data: parsed.data,
          waiver_accepted: true,
          waiver_acceptance_method: passport.claimed_user_id === userId ? "signed_in_self" : "participant_on_helper_device",
        };
      });
      setBusy(true);
      const result = await reserveGroup({ event_id: event.id, category_id: category.id, waiver_version_id: waiver.id, idempotency_key: key, participants });
      if (result.status !== "pending") throw new GroupCheckoutError("order_not_pending");
      try { sessionStorage.removeItem(storageKey); } catch { /* No storage access. */ }
      router.replace(`/group/order/${result.order_id}`);
    } catch (cause) {
      const name = cause instanceof GroupCheckoutError && cause.participantId
        ? passports.find(p => p.id === cause.participantId)?.first_name : null;
      const message = cause instanceof GroupCheckoutError && cause.code === "idempotency_conflict"
        ? "This booking key already reserved different details. Check Bookings I manage before starting another reservation."
        : cause instanceof Error ? cause.message : "Registration unavailable";
      setError(`${name ? `${name}: ` : ""}${message}`);
    } finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-2xl px-5 py-10 sm:px-6">
    <Link className="text-sm underline" href={`/register/${category.id}`}>Single participant registration</Link>
    <h1 className="mt-5 text-3xl font-bold">Register your group</h1>
    <p className="mt-2 text-muted-foreground">Everyone joins {event.name} · {category.label}. One payment reserves every selected place. Each runner gets a separate ticket.</p>
    <p className="mt-4 rounded-lg bg-secondary p-4 text-sm">Select up to 10 complete Race Passports. Each participant must read and accept the organizer waiver personally, including guests using your device.</p>
    <div className="mt-8 space-y-3">{passports.map(passport => {
      const valid = passportSchema(new Date().toISOString().slice(0, 10)).safeParse(passport).success;
      const active = selected.includes(passport.id);
      const name = `${passport.first_name ?? "Incomplete"} ${passport.last_name ?? "Passport"}`;
      return <div key={passport.id} className="rounded-xl border border-border p-4">
        <label className="flex cursor-pointer items-center gap-3 font-semibold">
          <Checkbox checked={active} disabled={!valid || (!active && selected.length >= 10)} onCheckedChange={() => toggle(passport.id)} aria-label={`Select ${name}`} />
          <span>{name}</span><span className="ml-auto text-sm font-normal text-muted-foreground">{passport.claimed_user_id === userId ? "Your Passport" : "Managed participant"}</span>
        </label>
        {!valid ? <p className="mt-2 text-sm text-destructive">Complete this Race Passport before booking.</p> : null}
        {active ? <div className="mt-5 space-y-5 border-t pt-5">
          <div><label className="block text-sm font-medium" htmlFor={`shirt-${passport.id}`}>Shirt size</label>
            <select id={`shirt-${passport.id}`} value={lines[passport.id]?.shirtSize ?? ""} onChange={e => updateLine(passport.id, { shirtSize: e.target.value })} className="mt-2 w-full rounded-lg border bg-background p-3">
              <option value="">Use saved Passport size</option>{SHIRT_SIZES.map(size => <option key={size}>{size}</option>)}
            </select></div>
          {eventFields.map(field => <DynamicField key={field.id} idPrefix={`${passport.id}-`} field={field} value={lines[passport.id]?.values[field.key]} onChange={value => updateLine(passport.id, { values: { ...lines[passport.id]?.values, [field.key]: value } })} />)}
          {addons.map(addon => <label key={addon.id} className="flex items-center gap-3 text-sm"><Checkbox checked={(lines[passport.id]?.addonIds ?? []).includes(addon.id)} onCheckedChange={() => {
            const ids = lines[passport.id]?.addonIds ?? [];
            updateLine(passport.id, { addonIds: ids.includes(addon.id) ? ids.filter(value => value !== addon.id) : [...ids, addon.id] });
          }} />{addon.name} · {formatPeso(addon.price)}</label>)}
          {passport.claimed_user_id !== userId ? <p className="rounded-lg bg-muted p-3 text-sm">Pass the device to {passport.first_name}. They must accept the waiver personally.</p> : null}
          <details className="rounded-lg border p-3"><summary className="cursor-pointer font-semibold">{waiver.title}</summary><p className="mt-3 whitespace-pre-line text-sm">{waiver.body}</p></details>
          <label className="flex items-center gap-3 text-sm"><Checkbox checked={lines[passport.id]?.accepted ?? false} onCheckedChange={checked => setLines(current => ({ ...current, [passport.id]: { ...(current[passport.id] ?? emptyLine()), accepted: checked === true } }))} aria-label={`${name} accepts waiver`} />
            {passport.claimed_user_id === userId ? "I personally accept" : `I, ${name}, personally accept`} this organizer waiver.</label>
        </div> : null}
      </div>;
    })}</div>
    <Link href="/profile" className="mt-5 inline-block text-sm underline">Add or complete a Race Passport</Link>
    <div className="mt-8 rounded-xl border p-5"><p>{selected.length} participant{selected.length === 1 ? "" : "s"}</p><p className="mt-2 text-xl font-bold">Entry and add-ons: {formatPeso(total)}</p>
      <p className="mt-2 text-sm text-muted-foreground">Race Pace fees and any PayMongo processing fee appear in the payment review before you pay.</p></div>
    {error ? <p role="alert" className="mt-5 text-sm text-destructive">{error}</p> : null}
    <Button className="mt-6 w-full" disabled={!ready || busy || selected.length === 0} onClick={submit}>{busy ? "Reserving…" : `Reserve ${selected.length} place${selected.length === 1 ? "" : "s"}`}</Button>
  </div>;
}
