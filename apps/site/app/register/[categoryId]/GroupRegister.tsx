"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, QrCode, ReceiptText, ShieldCheck } from "lucide-react";
import { customDataSchema, formatPeso, isProfileKey, passportSchema, SHIRT_SIZES, type GroupReservationInput } from "@race-pace/shared";
import type { AddonRow, CategoryRow, EventRow, FormFieldRow } from "@/lib/events";
import { assertGroupSelection, GroupCheckoutError, reserveGroup } from "@/lib/groupCheckout";
import { DynamicField } from "@/components/DynamicField";
import { TrailRosterParticipantSelector, type RosterSelection } from "@/components/registration/TrailRosterParticipantSelector";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type GroupPassport = {
  id: string; claimed_user_id: string | null; first_name: string | null; last_name: string | null;
  shirt_size: string | null; blood_type: string | null; team_name: string | null; date_of_birth: string | null; gender: string | null;
  contact_number: string | null; emergency_contact_name: string | null;
  emergency_contact_number: string | null; emergency_contact_relationship: string | null;
  shipping_barangay_code: string | null; shipping_zip_code: string | null; shipping_address_line: string | null;
};

type Line = { categoryId: string; addonIds: string[]; shirtSize: string; values: Record<string, unknown>; accepted: boolean };
const emptyLine = (categoryId: string): Line => ({ categoryId, addonIds: [], shirtSize: "", values: {}, accepted: false });

export function GroupRegister({ userId, initialCategory, categories, event, passports, addons, fields, waiver }: {
  userId: string; initialCategory: CategoryRow; categories: CategoryRow[]; event: EventRow; passports: GroupPassport[];
  addons: AddonRow[]; fields: FormFieldRow[]; waiver: { id: string; title: string; body: string };
}) {
  const router = useRouter();
  const storageKey = `rp:group:${userId}:${event.id}`;
  const [key, setKey] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<"roster" | "details">("roster");
  const eventFields = useMemo(() => fields.filter(f => !isProfileKey(f.key)), [fields]);
  const rosterCategories = useMemo(() => [...categories]
    .sort((a, b) => Number(b.id === initialCategory.id) - Number(a.id === initialCategory.id))
    .map(category => ({ id: category.id, label: category.label, price: category.base_price,
      available: Math.max(0, category.slots_total - category.slots_taken) })), [categories, initialCategory.id]);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as { key?: string; selected?: string[]; lines?: Record<string, Line> } | null;
      setKey(saved?.key ?? crypto.randomUUID());
      setSelected((saved?.selected ?? []).filter(id => passports.some(p => p.id === id)));
      setLines(Object.fromEntries(Object.entries(saved?.lines ?? {}).map(([id, line]) => [id, {
        ...emptyLine(initialCategory.id), ...line, categoryId: line.categoryId ?? initialCategory.id, accepted: false,
      }])));
    } catch { setKey(crypto.randomUUID()); }
    setReady(true);
  }, [storageKey, passports, initialCategory.id]);

  useEffect(() => {
    if (!ready || !key) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ key, selected, lines: Object.fromEntries(Object.entries(lines).map(([id, line]) => [id, { ...line, accepted: false }])) })); }
    catch { /* Private browsing can deny storage; the current tab still works. */ }
  }, [storageKey, key, selected, lines, ready]);

  function updateRoster(next: RosterSelection[]) {
    setError(null);
    setSelected(next.map(selection => selection.passportId));
    setLines(current => ({ ...current, ...Object.fromEntries(next.map(selection => [
      selection.passportId,
      { ...(current[selection.passportId] ?? emptyLine(selection.categoryId)), categoryId: selection.categoryId,
        accepted: current[selection.passportId]?.categoryId === selection.categoryId && current[selection.passportId]?.accepted === true },
    ])) }));
  }
  function updateLine(id: string, patch: Partial<Line>) {
    setLines(current => ({ ...current, [id]: { ...(current[id] ?? emptyLine(initialCategory.id)), ...patch, accepted: false } }));
  }
  const rosterSelections = selected.map(passportId => ({ passportId, categoryId: lines[passportId]?.categoryId ?? initialCategory.id }));
  const entryTotal = selected.reduce((sum, id) => sum + (categories.find(category => category.id === lines[id]?.categoryId)?.base_price ?? 0), 0);
  const total = selected.reduce((sum, id) => sum + (categories.find(category => category.id === lines[id]?.categoryId)?.base_price ?? 0) +
    (lines[id]?.addonIds ?? []).reduce((amount, addonId) => amount + (addons.find(a => a.id === addonId)?.price ?? 0), 0), 0);
  const categoryCount = new Set(rosterSelections.map(selection => selection.categoryId)).size;
  const selectedParticipants = selected.map(id => {
    const passport = passports.find(value => value.id === id)!;
    const category = categories.find(value => value.id === lines[id]?.categoryId);
    return {
      id,
      name: `${passport.first_name ?? "Incomplete"} ${passport.last_name ?? "Passport"}`,
      relationship: passport.claimed_user_id === userId ? "Your Race Passport" : "Managed Race Passport",
      category,
      passport,
    };
  });

  async function submit() {
    setError(null);
    try {
      assertGroupSelection(selected, 10);
      if (!key) throw new GroupCheckoutError("checkout_not_ready");
      if (total <= 0) throw new GroupCheckoutError("free_group_checkout_unavailable");
      const categoryCounts = selected.reduce<Record<string, number>>((counts, id) => {
        const categoryId = lines[id]?.categoryId;
        if (!categoryId) throw new GroupCheckoutError("category_required", id);
        counts[categoryId] = (counts[categoryId] ?? 0) + 1;
        return counts;
      }, {});
      for (const [categoryId, count] of Object.entries(categoryCounts)) {
        const category = categories.find(value => value.id === categoryId);
        if (!category || count > Math.max(0, category.slots_total - category.slots_taken)) {
          throw new GroupCheckoutError("category_capacity_exhausted", undefined, categoryId);
        }
      }
      const definitions = eventFields.map(f => ({ key: f.key, label: f.label, type: f.type, required: f.required, options: f.options ?? undefined }));
      const participants: GroupReservationInput["participants"] = selected.map(id => {
        const passport = passports.find(p => p.id === id)!;
        const line = lines[id] ?? emptyLine(initialCategory.id);
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
          category_id: line.categoryId,
          addon_ids: line.addonIds,
          ...(line.shirtSize ? { shirt_size: line.shirtSize as (typeof SHIRT_SIZES)[number] } : {}),
          custom_data: parsed.data,
          waiver_accepted: true,
          waiver_acceptance_method: passport.claimed_user_id === userId ? "signed_in_self" : "participant_on_helper_device",
        };
      });
      setBusy(true);
      const result = await reserveGroup({ event_id: event.id, waiver_version_id: waiver.id, idempotency_key: key, participants });
      if (result.status !== "pending") throw new GroupCheckoutError("order_not_pending");
      try { sessionStorage.removeItem(storageKey); } catch { /* No storage access. */ }
      router.replace(`/group/order/${result.order_id}`);
    } catch (cause) {
      const name = cause instanceof GroupCheckoutError && cause.participantId
        ? passports.find(p => p.id === cause.participantId)?.first_name : null;
      const categoryLabel = cause instanceof GroupCheckoutError && cause.categoryId
        ? categories.find(category => category.id === cause.categoryId)?.label : null;
      const message = cause instanceof GroupCheckoutError && cause.code === "idempotency_conflict"
        ? "This booking key already reserved different details. Check Bookings I manage before starting another reservation."
        : cause instanceof Error ? cause.message : "Registration unavailable";
      setError(`${name ? `${name}: ` : categoryLabel ? `${categoryLabel}: ` : ""}${message}`);
    } finally { setBusy(false); }
  }

  if (step === "roster") return <div className="bg-[#f5f5f1] px-2.5 py-[18px] sm:px-[18px] sm:py-[30px] lg:pb-[72px]">
    <section className="mx-auto w-full max-w-[1160px] overflow-hidden rounded-[18px] bg-white shadow-[0_24px_70px_rgba(17,42,29,0.11)] sm:rounded-3xl">
      <header className="grid bg-[#103226] px-[22px] py-7 text-white sm:px-10 sm:py-9 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-7">
        <div className="self-center">
          <p className="font-eyebrow text-[11px] font-bold uppercase tracking-[0.24em] text-[#79d9a7]">Group registration · Step 1 of 3</p>
          <h1 className="mt-3 max-w-[680px] font-display text-[clamp(2.35rem,5vw,4rem)] font-bold leading-[0.98] tracking-[-0.045em]">Build your race roster.</h1>
          <p className="mt-5 max-w-[680px] text-[15px] leading-6 text-white/72 sm:text-base">Select only the runners attending. Your own Passport is optional, and every runner can join a different category.</p>
        </div>
        <div className="hidden rounded-2xl border border-white/15 bg-white/[0.07] p-5 lg:block">
          <p className="font-eyebrow text-[10px] font-bold uppercase tracking-[0.22em] text-[#79d9a7]">You’re registering for</p>
          <p className="mt-3 font-display text-xl font-bold leading-6">{event.name}</p>
          <div className="mt-5 border-t border-white/15 pt-4 text-sm leading-5 text-white/70"><p>One payment</p><p>Separate registrations and QR tickets</p></div>
        </div>
      </header>

      <div className="grid gap-7 px-4 py-[22px] sm:px-[34px] sm:py-[30px] lg:grid-cols-[minmax(0,1fr)_330px] lg:gap-[26px] lg:pb-9">
        <div className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#e7ece8] pb-5">
            <div><p className="font-eyebrow text-[10px] font-bold uppercase tracking-[0.22em] text-[#0c6d3b]">Race Passports</p><h2 className="mt-2 font-display text-2xl font-bold tracking-[-0.025em] text-[#14211a]">Who is joining?</h2><p className="mt-1 text-sm leading-5 text-[#657069]">Choose a Passport, then assign that runner’s category.</p></div>
            <p className="font-mono-race text-xs text-[#657069]" aria-live="polite">{selected.length} of {passports.length} selected</p>
          </div>
          <div className="pt-5">
            <TrailRosterParticipantSelector
              passports={passports.map(passport => ({ id: passport.id, name: `${passport.first_name ?? "Incomplete"} ${passport.last_name ?? "Passport"}`, relationship: passport.claimed_user_id === userId ? "Your Race Passport" : "Managed Race Passport", valid: passportSchema(new Date().toISOString().slice(0, 10)).safeParse(passport).success }))}
              categories={rosterCategories}
              selections={rosterSelections}
              onSelectionsChange={updateRoster}
            />
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f3f5f1] px-4 py-3 text-sm"><span className="text-[#657069]">Missing someone or need to update a Passport?</span><Link href="/profile" className="font-semibold text-[#0c6d3b] underline decoration-[#0c6d3b]/30 underline-offset-4 hover:decoration-current">Manage Race Passports</Link></div>
          <Link className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold text-[#526059] underline decoration-[#526059]/35 underline-offset-4" href={`/register/${initialCategory.id}`}>Register only myself instead</Link>
        </div>

        <aside className="self-start lg:sticky lg:top-[98px]" aria-label="Roster summary">
          <div className="overflow-hidden rounded-2xl border border-[#dce3de] bg-white">
            <div className="bg-[#103226] px-5 py-[18px] text-white"><div className="flex items-center gap-2"><ReceiptText className="size-[18px] text-[#79d9a7]" aria-hidden="true" /><h2 className="font-display text-lg font-bold">Your roster</h2></div><p className="mt-1 text-xs text-white/65">One booking for everyone selected</p></div>
            <div className="px-5 py-4">
              {selectedParticipants.length === 0 ? <div className="rounded-xl bg-[#f3f5f1] px-4 py-5 text-center"><p className="text-sm font-semibold text-[#14211a]">No runners selected yet</p><p className="mt-1 text-xs leading-5 text-[#657069]">Choose at least one Race Passport to continue.</p></div> : <ul className="divide-y divide-[#e7ece8]" aria-live="polite">
                {selectedParticipants.map(participant => <li key={participant.id} className="flex items-start justify-between gap-4 py-3 first:pt-0"><div className="min-w-0"><p className="truncate text-sm font-bold text-[#14211a]">{participant.name}</p><p className="mt-0.5 truncate text-xs text-[#657069]">{participant.category?.label}</p></div><span className="shrink-0 font-mono-race text-xs font-semibold text-[#14211a]">{formatPeso(participant.category?.base_price ?? 0)}</span></li>)}
              </ul>}
              <div className="mt-4 flex items-center justify-between border-t border-[#dce3de] pt-4"><div><p className="text-xs text-[#657069]">Entry subtotal</p><p className="mt-1 text-[11px] text-[#859089]">Add-ons come next</p></div><p className="font-display text-xl font-bold text-[#14211a]">{formatPeso(entryTotal)}</p></div>
              <Button className="mt-5 h-12 w-full rounded-xl bg-[#159a55] text-sm font-bold shadow-[0_8px_20px_rgba(21,154,85,0.2)] hover:bg-[#0c7a42]" disabled={!ready || selected.length === 0} onClick={() => { setError(null); setStep("details"); }}>Continue with {selected.length} runner{selected.length === 1 ? "" : "s"}<ArrowRight aria-hidden="true" /></Button>
              <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-[#657069]"><ShieldCheck className="size-3.5 text-[#0c6d3b]" aria-hidden="true" />Nothing is charged on this step.</div>
            </div>
          </div>
        </aside>
      </div>
    </section>
  </div>;

  return <div className="bg-[#f5f5f1] px-2.5 py-[18px] sm:px-[18px] sm:py-[30px] lg:pb-[72px]">
    <section className="mx-auto w-full max-w-[980px] overflow-hidden rounded-[18px] bg-white shadow-[0_24px_70px_rgba(17,42,29,0.11)] sm:rounded-3xl">
    <header className="bg-[#103226] px-[22px] py-7 text-white sm:px-10 sm:py-9">
      <button type="button" onClick={() => { setError(null); setStep("roster"); }} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-white/75 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"><ArrowLeft className="size-4" aria-hidden="true" />Back to roster</button>
      <p className="mt-5 font-eyebrow text-[11px] font-bold uppercase tracking-[0.24em] text-[#79d9a7]">Group registration · Step 2 of 3</p>
      <h1 className="mt-3 font-display text-[clamp(2rem,5vw,3.25rem)] font-bold leading-none tracking-[-0.04em]">Complete each runner’s entry.</h1>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-white/70 sm:text-base">Review each category, add event details, and let every participant accept the waiver personally.</p>
    </header>
    <div className="px-4 py-6 sm:px-9 sm:py-8">
    <div className="space-y-5">{passports.filter(passport => selected.includes(passport.id)).map(passport => {
      const valid = passportSchema(new Date().toISOString().slice(0, 10)).safeParse(passport).success;
      const name = `${passport.first_name ?? "Incomplete"} ${passport.last_name ?? "Passport"}`;
      const selectedCategory = categories.find(category => category.id === lines[passport.id]?.categoryId);
      return <Card key={passport.id} className="gap-5 rounded-2xl border-[#dce3de] shadow-none">
        <CardHeader className="border-b border-[#e7ece8]">
          <div className="flex flex-wrap items-center gap-2"><CardTitle className="font-display text-xl">{name}</CardTitle><Badge variant="secondary" className="rounded-full bg-[#e8f5ee] text-[#0c6d3b]">{selectedCategory?.label}</Badge></div>
          <CardDescription>Complete this runner’s entry details and personal waiver acceptance.</CardDescription>
        </CardHeader>
        <CardContent>
        {!valid ? <p className="mt-2 text-sm text-destructive">Complete this Race Passport before booking.</p> : null}
        <div className="space-y-5">
          <div><label className="block text-sm font-medium" htmlFor={`shirt-${passport.id}`}>Shirt size</label>
            <Select value={lines[passport.id]?.shirtSize || "saved"} onValueChange={value => updateLine(passport.id, { shirtSize: value === "saved" ? "" : value })}>
              <SelectTrigger id={`shirt-${passport.id}`} className="mt-2 h-11 w-full"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="saved">Use saved Passport size</SelectItem>{SHIRT_SIZES.map(size => <SelectItem key={size} value={size}>{size}</SelectItem>)}</SelectContent>
            </Select></div>
          {eventFields.map(field => <DynamicField key={field.id} idPrefix={`${passport.id}-`} field={field} value={lines[passport.id]?.values[field.key]} onChange={value => updateLine(passport.id, { values: { ...lines[passport.id]?.values, [field.key]: value } })} />)}
          {addons.map(addon => <label key={addon.id} className="flex items-center gap-3 text-sm"><Checkbox checked={(lines[passport.id]?.addonIds ?? []).includes(addon.id)} onCheckedChange={() => {
            const ids = lines[passport.id]?.addonIds ?? [];
            updateLine(passport.id, { addonIds: ids.includes(addon.id) ? ids.filter(value => value !== addon.id) : [...ids, addon.id] });
          }} />{addon.name} · {formatPeso(addon.price)}</label>)}
          {passport.claimed_user_id !== userId ? <p className="rounded-xl bg-[#f3f5f1] p-4 text-sm">Pass the device to {passport.first_name}. They must accept the waiver personally.</p> : null}
          <details className="rounded-xl border border-[#dce3de] p-4"><summary className="cursor-pointer font-semibold">{waiver.title}</summary><p className="mt-3 whitespace-pre-line text-sm">{waiver.body}</p></details>
          <label className="flex min-h-11 items-start gap-3 text-sm"><Checkbox className="mt-0.5" checked={lines[passport.id]?.accepted ?? false} onCheckedChange={checked => setLines(current => ({ ...current, [passport.id]: { ...(current[passport.id] ?? emptyLine(initialCategory.id)), accepted: checked === true } }))} aria-label={`${name} accepts waiver`} />
            <span>{passport.claimed_user_id === userId ? "I personally accept" : `I, ${name}, personally accept`} this organizer waiver.</span></label>
        </div>
        </CardContent>
      </Card>;
    })}</div>
    <Card className="mt-6 gap-4 rounded-2xl border-[#dce3de] shadow-none"><CardHeader><CardTitle className="flex items-center gap-2 font-display"><QrCode className="size-5 text-[#0c6d3b]" aria-hidden="true" />Booking summary</CardTitle><CardDescription>{selected.length} participant{selected.length === 1 ? "" : "s"} across {categoryCount} categor{categoryCount === 1 ? "y" : "ies"}. Each paid registration receives its own QR ticket.</CardDescription></CardHeader>
      <CardContent><div className="flex items-center justify-between gap-4"><p className="font-semibold">Entry and add-ons</p><p className="font-display text-xl font-bold">{formatPeso(total)}</p></div>
      <p className="mt-2 text-sm text-muted-foreground">Race Pace fees and any PayMongo processing fee appear in the payment review before you pay.</p></CardContent>
    </Card>
    {error ? <p role="alert" className="mt-5 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p> : null}
    <Button className="mt-6 h-12 w-full rounded-xl bg-[#159a55] font-bold hover:bg-[#0c7a42]" disabled={!ready || busy || selected.length === 0} onClick={submit}>{busy ? "Reserving…" : `Reserve ${selected.length} place${selected.length === 1 ? "" : "s"}`}<CheckCircle2 aria-hidden="true" /></Button>
    </div>
    </section>
  </div>;
}
