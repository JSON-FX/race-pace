import { supabase } from "./supabase";

export type CategoryDraft = { id?: string; tempId?: string; code: string; label: string; distance_km: number | null; base_price: number; slots_total: number };
export type AddonDraft = { id?: string; tempId?: string; name: string; price: number };
export type EventDraft = {
  id?: string; org_id: string; name: string;
  city_psgc_code: string | null; region_name: string | null; province_name: string | null; city_name: string | null; venue: string | null;
  event_date: string | null; end_date: string | null; flag_off: string | null; status: string;
  elevation_gain_m: number | null; cutoff_hours: number | null; description: string | null;
  hero_image_url: string | null; gallery: string[];
};

type WithId = { id?: string };
export function reconcileChildren<T extends WithId>(original: WithId[], current: T[]) {
  const currentIds = new Set(current.filter((c) => c.id).map((c) => c.id));
  return {
    toInsert: current.filter((c) => !c.id),
    toUpdate: current.filter((c) => c.id) as (T & { id: string })[],
    toDelete: original.filter((o) => o.id && !currentIds.has(o.id)).map((o) => o.id!) as string[],
  };
}

const EVENT_COLS = (e: EventDraft) => ({
  org_id: e.org_id, name: e.name,
  city_psgc_code: e.city_psgc_code, region_name: e.region_name, province_name: e.province_name, city_name: e.city_name, venue: e.venue,
  event_date: e.event_date, end_date: e.end_date, flag_off: e.flag_off, status: e.status,
  elevation_gain_m: e.elevation_gain_m, cutoff_hours: e.cutoff_hours,
  description: e.description, hero_image_url: e.hero_image_url, gallery: e.gallery,
});

export async function saveEvent(args: {
  event: EventDraft;
  categories: { current: CategoryDraft[]; original: { id?: string }[] };
  addons: { current: AddonDraft[]; original: { id?: string }[] };
}): Promise<{ eventId: string; childErrors: string[] }> {
  const { event } = args;
  let eventId = event.id;
  if (!eventId) {
    const ins = await supabase.from("events").insert(EVENT_COLS(event)).select("id").single();
    if (ins.error) throw new Error(ins.error.message);
    eventId = ins.data!.id;
  } else {
    const upd = await supabase.from("events").update(EVENT_COLS(event)).eq("id", eventId);
    if (upd.error) throw new Error(upd.error.message);
  }

  const childErrors: string[] = [];
  const cat = reconcileChildren(args.categories.original, args.categories.current);
  for (const c of cat.toInsert) {
    const r = await supabase.from("categories").insert({ org_id: event.org_id, event_id: eventId, code: c.code, label: c.label, distance_km: c.distance_km, base_price: c.base_price, slots_total: c.slots_total });
    if (r.error) childErrors.push(`Category "${c.label}": ${r.error.message}`);
  }
  for (const c of cat.toUpdate) {
    const r = await supabase.from("categories").update({ code: c.code, label: c.label, distance_km: c.distance_km, base_price: c.base_price, slots_total: c.slots_total }).eq("id", c.id);
    if (r.error) childErrors.push(`Category "${c.label}": ${r.error.message}`);
  }
  for (const id of cat.toDelete) {
    const r = await supabase.from("categories").delete().eq("id", id);
    if (r.error) childErrors.push(`Couldn't remove a category — it has registrations.`);
  }

  const add = reconcileChildren(args.addons.original, args.addons.current);
  for (const a of add.toInsert) {
    const r = await supabase.from("addons").insert({ org_id: event.org_id, event_id: eventId, name: a.name, price: a.price });
    if (r.error) childErrors.push(`Add-on "${a.name}": ${r.error.message}`);
  }
  for (const a of add.toUpdate) {
    const r = await supabase.from("addons").update({ name: a.name, price: a.price }).eq("id", a.id);
    if (r.error) childErrors.push(`Add-on "${a.name}": ${r.error.message}`);
  }
  for (const id of add.toDelete) {
    const r = await supabase.from("addons").delete().eq("id", id);
    if (r.error) childErrors.push(`Couldn't remove an add-on.`);
  }

  return { eventId: eventId!, childErrors };
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000);
}
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function rescheduleEvent(id: string, currentDate: string | null, currentEndDate: string | null, newDate: string, note: string): Promise<{ error?: string }> {
  const newEndDate = currentEndDate && currentDate ? addDays(newDate, daysBetween(currentDate, currentEndDate)) : null;
  const r = await supabase.from("events").update({ original_date: currentDate, event_date: newDate, end_date: newEndDate, status_note: note || null }).eq("id", id);
  return r.error ? { error: r.error.message } : {};
}
export async function cancelEvent(id: string, note: string): Promise<{ error?: string }> {
  const r = await supabase.from("events").update({ status: "cancelled", status_note: note || null }).eq("id", id);
  return r.error ? { error: r.error.message } : {};
}
