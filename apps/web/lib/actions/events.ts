"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles, type MyRoles } from "@/lib/queries/roles";
import type { EventDiscipline, RoutePoint } from "@race-pace/shared";
import type { ScheduleItem } from "@/lib/validation";
import { eventInputSchema, categoryInputSchema, addonInputSchema, sanitizeListFields, coordPairError, kitCutoffError, EVENT_STATUSES } from "@/lib/validation";
import { reconcileChildren } from "@/lib/reconcile-children";

const GENERIC_ERROR = "Something went wrong. Please try again.";

// ---- Draft shapes, ported verbatim from the old lib/eventWrites.ts -------

export type CategoryDraft = {
  id?: string; tempId?: string; code: string; label: string; distance_km: number | null; base_price: number; slots_total: number;
  elevation_gain_m: number | null; cutoff_hours: number | null; blurb: string | null;
};
export type AddonDraft = { id?: string; tempId?: string; name: string; price: number };
export type EventDraft = {
  id?: string; org_id: string; name: string;
  city_psgc_code: string | null; region_name: string | null; province_name: string | null; city_name: string | null; venue: string | null;
  event_date: string | null; end_date: string | null; flag_off: string | null; status: string; discipline: EventDiscipline;
  registration_closes_at: string | null; kit_edit_closes_at: string | null;
  elevation_gain_m: number | null; cutoff_hours: number | null; description: string | null;
  start_lat: number | null; start_lng: number | null; finish_lat: number | null; finish_lng: number | null;
  route: RoutePoint[] | null;
  hero_image_url: string | null; gallery: string[]; schedule: ScheduleItem[]; inclusions: string[];
};

const EVENT_COLS = (e: EventDraft) => ({
  org_id: e.org_id, name: e.name,
  city_psgc_code: e.city_psgc_code, region_name: e.region_name, province_name: e.province_name, city_name: e.city_name, venue: e.venue,
  event_date: e.event_date, end_date: e.end_date, flag_off: e.flag_off, status: e.status, discipline: e.discipline,
  registration_closes_at: e.registration_closes_at, kit_edit_closes_at: e.kit_edit_closes_at,
  elevation_gain_m: e.elevation_gain_m, cutoff_hours: e.cutoff_hours,
  start_lat: e.start_lat, start_lng: e.start_lng, finish_lat: e.finish_lat, finish_lng: e.finish_lng,
  route: e.route,
  description: e.description, hero_image_url: e.hero_image_url, gallery: e.gallery, schedule: e.schedule, inclusions: e.inclusions,
});

/**
 * Who may create/edit an event: any caller `auth_can_admin_org` would admit —
 * i.e. an `admin` OR `editor` row in the event's own org (or super_admin).
 * This intentionally mirrors RLS rather than narrowing it (contrast
 * lib/actions/settings.ts's assertCanEditOrg, which restricts organization
 * branding to admins ONLY even though RLS there also permits editors — that
 * is a deliberate product decision for org identity, not the default).
 * There is no equivalent narrower business rule for events: creating and
 * editing race content has always been an editor-level action in this app
 * (the old EventEditor route was reachable by anyone who could reach
 * /events, i.e. any org member, and RLS was the only gate). Verified
 * against supabase/migrations/20260721100000_events_write_rls.sql:
 *   create policy "events_insert_org_admin" on events for insert
 *     with check (auth_can_admin_org(org_id));
 *   create policy "events_update_org_admin" on events for update
 *     using (auth_can_admin_org(org_id)) with check (auth_can_admin_org(org_id));
 * and auth_can_admin_org (20260720150000_user_roles.sql):
 *   select auth_is_super_admin() or exists (select 1 from user_roles
 *     where user_id = auth.uid() and org_id = target and role in ('editor','admin'));
 *
 * `roles.isAdmin` (lib/queries/roles.ts) is true for super_admin OR any
 * resolved admin/editor row — exactly this set. `roles.orgId` is the org
 * that resolved row belongs to; the caller must match the event's org_id,
 * or an editor in org A could forge org_id "B" in the JSON payload and
 * create/update a row in org B (the request would still 403 at the RLS
 * layer, since the caller has no editor/admin row in org B — this check is
 * the same boundary duplicated at the app layer so a bad request fails
 * loudly with a clear message instead of a raw Postgres/RLS error).
 */
function assertCanWriteEvent(roles: MyRoles | null, orgId: string): string | null {
  if (!roles?.isAdmin) return "You don't have permission to edit this event.";
  // A super_admin (auth_is_super_admin() in the RLS policy) can admin ANY
  // org, not just the one `getMyRoles` happened to resolve `orgId` to — see
  // requireOrgId's doc comment in lib/queries/roles.ts: a super_admin with
  // no org-scoped admin/editor row resolves `orgId: null`, which must not
  // be treated as "belongs to no org" here.
  if (roles.isSuperAdmin) return null;
  if (roles.orgId !== orgId) return "You don't have permission to edit this event.";
  return null;
}

export type EditorState = { error?: string; eventId?: string };

type SavePayload = {
  event: EventDraft;
  categories: { current: CategoryDraft[]; original: { id?: string }[] };
  addons: { current: AddonDraft[]; original: { id?: string }[] };
};

export async function saveEventAction(_prev: EditorState, formData: FormData): Promise<EditorState> {
  const raw = formData.get("payload");
  if (typeof raw !== "string") return { error: GENERIC_ERROR };

  let payload: SavePayload;
  try {
    payload = JSON.parse(raw) as SavePayload;
  } catch {
    return { error: GENERIC_ERROR };
  }

  const roles = await getMyRoles();
  const denied = assertCanWriteEvent(roles, payload.event.org_id);
  if (denied) return { error: denied };

  // Re-validate server-side — the client already blocks Save on an invalid
  // draft, but a Server Action is a public HTTP endpoint and this FormData
  // payload can be forged by anything that can reach it, not just the form.
  // Status is checked separately below (against currentStatus), not by
  // eventInputSchema's own status enum, which excludes "cancelled" — see
  // that block's comment.
  const sanitized = sanitizeListFields(payload.event);
  // coordPairError runs on the PARSED output, not `sanitized` directly —
  // start/finish lat/lng are `.default(null)` in the schema, so a forged
  // payload that omits a field entirely (as opposed to sending an explicit
  // null, which is all the client form ever does) is normalized before the
  // pairing check rather than slipping past it into the DB's CHECK
  // constraint, where it would only ever surface as the generic error.
  const parsed = eventInputSchema.omit({ status: true }).safeParse(sanitized);
  if (!parsed.success) {
    return { error: "Fix the event fields (name is required, valid date/time, schedule times as HH:MM, inclusion lines under 140 characters)." };
  }
  const coordError = coordPairError(parsed.data);
  if (coordError) return { error: coordError };
  if (sanitized.end_date && sanitized.event_date && sanitized.end_date < sanitized.event_date) {
    return { error: "End date can't be before the start date." };
  }
  const kitError = kitCutoffError(sanitized);
  if (kitError) return { error: kitError };
  for (const c of payload.categories.current) {
    if (!categoryInputSchema.safeParse(c).success) {
      return { error: "Fix the category rows (code, label, non-negative price/slots, gain 0-30000m, cut-off 0-240h)." };
    }
  }
  for (const a of payload.addons.current) {
    if (!addonInputSchema.safeParse(a).success) return { error: "Fix the add-on rows (name, non-negative price)." };
  }

  const supabase = await createClient();
  const eventId = payload.event.id;

  // "cancelled" is outside eventInputSchema's status enum by design — it's
  // set only via the Cancel modal (cancelEventAction), which also writes
  // status_note. Without this check, a forged Save payload could set
  // status: "cancelled" directly, silently skipping the cancellation note.
  // A row that is ALREADY cancelled may still round-trip through Save
  // unchanged (matches the client validator's "don't dead-end on the status
  // validator" behavior for a cancelled event) — that's the one case
  // "cancelled" is allowed here, and only because it was already true in
  // the database, not because the client claimed it.
  let currentStatus: string | null = null;
  if (eventId) {
    const cur = await supabase.from("events").select("status").eq("id", eventId).single();
    if (cur.error) {
      console.error("[events] event status lookup failed", { eventId, error: cur.error });
      return { error: GENERIC_ERROR };
    }
    currentStatus = cur.data.status;
  }
  const statusOk = sanitized.status === "cancelled"
    ? currentStatus === "cancelled"
    : (EVENT_STATUSES as readonly string[]).includes(sanitized.status);
  if (!statusOk) {
    return { error: "Fix the event fields (invalid status)." };
  }

  const event: EventDraft = { ...sanitized, id: eventId };

  let finalEventId = eventId;
  if (!finalEventId) {
    const ins = await supabase.from("events").insert(EVENT_COLS(event)).select("id").single();
    if (ins.error) {
      console.error("[events] event insert failed", { orgId: event.org_id, error: ins.error });
      return { error: GENERIC_ERROR };
    }
    finalEventId = ins.data!.id;
  } else {
    // .select("id") + the empty-result check matter here: an UPDATE blocked
    // by RLS (rather than by the grant) does not raise an error — it
    // silently affects zero rows. assertCanWriteEvent above is what actually
    // prevents that in the normal case; this is the honest-response check
    // for when it's ever wrong (stale roles cache, org reassignment, etc.).
    const upd = await supabase.from("events").update(EVENT_COLS(event)).eq("id", finalEventId).select("id");
    if (upd.error) {
      console.error("[events] event update failed", { eventId: finalEventId, error: upd.error });
      return { error: GENERIC_ERROR };
    }
    if (!upd.data || upd.data.length === 0) return { error: GENERIC_ERROR };
  }

  // The diff itself is computed against the client-supplied
  // payload.categories.original / payload.addons.original — exactly as
  // reconcileChildren always had it (ported verbatim, byte-identical to the
  // old lib/eventWrites.ts). What changed for security is scoping every
  // write below to `finalEventId` with `.eq("event_id", finalEventId)`:
  // RLS on categories/addons only checks the PARENT event's org
  // (categories_delete_org_admin etc.), not that a given row belongs to
  // THIS event, so without that `.eq` a stale tab, a double-submit racing
  // router.refresh(), or a crafted request naming another event's (same
  // org) category id in `original` could delete/update it. `.eq("id", …)`
  // ALONE against a foreign id already matches zero rows and is a no-op —
  // the `.eq("event_id", …)` is what makes that explicit and load-bearing
  // rather than incidental.
  //
  // Deliberately NOT re-deriving `original` from a fresh DB query (an
  // earlier version of this fix did, and it was wrong): the diff needs to
  // reflect what THIS SAVE REQUEST believes existed when the form was
  // loaded, not what the DB holds right now. If tab A adds category X and
  // saves, then a stale tab B (which never saw X) saves, a DB-derived
  // `original` would see X as "already there" and compute it as "no longer
  // present in tab B's `current`" — silently deleting tab A's category (and
  // throwing a confusing "has registrations" error if X already has
  // registrations by then). The client-supplied `original` correctly
  // leaves X alone, since tab B never claimed to know about it.
  const childErrors: string[] = [];
  const cat = reconcileChildren(payload.categories.original, payload.categories.current);
  for (const c of cat.toInsert) {
    const r = await supabase.from("categories").insert({ org_id: event.org_id, event_id: finalEventId, code: c.code, label: c.label, distance_km: c.distance_km, base_price: c.base_price, slots_total: c.slots_total, elevation_gain_m: c.elevation_gain_m, cutoff_hours: c.cutoff_hours, blurb: c.blurb });
    // Never surface `r.error.message` (raw Postgres text — table/column/
    // constraint names) to the UI. Log it server-side with context; the
    // admin gets a generic, actionable message naming no internals. Matches
    // lib/actions/settings.ts and the friendly strings already used by the
    // delete branches below.
    if (r.error) {
      console.error("[events] category insert failed", { eventId: finalEventId, code: c.code, error: r.error });
      childErrors.push(`Category "${c.label}" couldn't be saved.`);
    }
  }
  for (const c of cat.toUpdate) {
    const r = await supabase.from("categories").update({ code: c.code, label: c.label, distance_km: c.distance_km, base_price: c.base_price, slots_total: c.slots_total, elevation_gain_m: c.elevation_gain_m, cutoff_hours: c.cutoff_hours, blurb: c.blurb }).eq("id", c.id).eq("event_id", finalEventId);
    if (r.error) {
      console.error("[events] category update failed", { eventId: finalEventId, categoryId: c.id, error: r.error });
      childErrors.push(`Category "${c.label}" couldn't be saved.`);
    }
  }
  for (const id of cat.toDelete) {
    // .eq("event_id", finalEventId) is load-bearing, not redundant with RLS
    // — see the comment above `cat`.
    const r = await supabase.from("categories").delete().eq("id", id).eq("event_id", finalEventId);
    if (r.error) childErrors.push(`Couldn't remove a category — it has registrations.`);
  }

  const add = reconcileChildren(payload.addons.original, payload.addons.current);
  for (const a of add.toInsert) {
    const r = await supabase.from("addons").insert({ org_id: event.org_id, event_id: finalEventId, name: a.name, price: a.price });
    if (r.error) {
      console.error("[events] addon insert failed", { eventId: finalEventId, name: a.name, error: r.error });
      childErrors.push(`Add-on "${a.name}" couldn't be saved.`);
    }
  }
  for (const a of add.toUpdate) {
    const r = await supabase.from("addons").update({ name: a.name, price: a.price }).eq("id", a.id).eq("event_id", finalEventId);
    if (r.error) {
      console.error("[events] addon update failed", { eventId: finalEventId, addonId: a.id, error: r.error });
      childErrors.push(`Add-on "${a.name}" couldn't be saved.`);
    }
  }
  for (const id of add.toDelete) {
    const r = await supabase.from("addons").delete().eq("id", id).eq("event_id", finalEventId);
    if (r.error) childErrors.push(`Couldn't remove an add-on.`);
  }

  revalidatePath("/events");
  revalidatePath(`/events/${finalEventId}/edit`);

  return { eventId: finalEventId, error: childErrors.length ? childErrors.join(" ") : undefined };
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000);
}
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Reschedule keeps the original 5-argument shape from lib/eventWrites.ts
 * (id, currentDate, currentEndDate, newDate, note) rather than the task
 * brief's abbreviated `(id, newDate)` — RescheduleModal already calls it
 * with all five, and the signature is a reasonable public shape. Per the
 * task instructions, the existing module wins where it disagrees with the
 * brief.
 *
 * The `currentDate`/`currentEndDate` ARGUMENTS are intentionally not used
 * for the actual write below — they're client-supplied (RescheduleModal's
 * local component state) and could be stale (a second tab, a slow page that
 * missed a concurrent edit). The end_date-shift math and `original_date`
 * are computed from `row.data.event_date`/`end_date`, fetched fresh in the
 * same query as the org_id authorization check, so a stale client can't
 * silently corrupt end_date's shift or overwrite original_date with a
 * value that was never actually current.
 */
export async function rescheduleEventAction(
  id: string,
  _currentDate: string | null,
  _currentEndDate: string | null,
  newDate: string,
  note: string,
): Promise<{ error?: string }> {
  const supabase = await createClient();

  const row = await supabase.from("events").select("org_id, event_date, end_date").eq("id", id).single();
  if (row.error) {
    console.error("[events] reschedule lookup failed", { eventId: id, error: row.error });
    return { error: GENERIC_ERROR };
  }

  const roles = await getMyRoles();
  const denied = assertCanWriteEvent(roles, row.data.org_id);
  if (denied) return { error: denied };

  const currentDate = row.data.event_date;
  const currentEndDate = row.data.end_date;
  const newEndDate = currentEndDate && currentDate ? addDays(newDate, daysBetween(currentDate, currentEndDate)) : null;
  const upd = await supabase.from("events")
    .update({ original_date: currentDate, event_date: newDate, end_date: newEndDate, status_note: note || null })
    .eq("id", id)
    .select("id");
  if (upd.error) {
    console.error("[events] reschedule update failed", { eventId: id, error: upd.error });
    return { error: GENERIC_ERROR };
  }
  if (!upd.data || upd.data.length === 0) return { error: GENERIC_ERROR };

  revalidatePath("/events");
  revalidatePath(`/events/${id}/edit`);
  return {};
}

export async function cancelEventAction(id: string, note: string): Promise<{ error?: string }> {
  const supabase = await createClient();

  const row = await supabase.from("events").select("org_id").eq("id", id).single();
  if (row.error) {
    console.error("[events] cancel lookup failed", { eventId: id, error: row.error });
    return { error: GENERIC_ERROR };
  }

  const roles = await getMyRoles();
  const denied = assertCanWriteEvent(roles, row.data.org_id);
  if (denied) return { error: denied };

  const upd = await supabase.from("events").update({ status: "cancelled", status_note: note || null }).eq("id", id).select("id");
  if (upd.error) {
    console.error("[events] cancel update failed", { eventId: id, error: upd.error });
    return { error: GENERIC_ERROR };
  }
  if (!upd.data || upd.data.length === 0) return { error: GENERIC_ERROR };

  revalidatePath("/events");
  revalidatePath(`/events/${id}/edit`);
  return {};
}
