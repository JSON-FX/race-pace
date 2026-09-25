"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles, type MyRoles } from "@/lib/queries/roles";
import type { EventDiscipline, RoutePoint } from "@race-pace/shared";
import type { ScheduleItem } from "@/lib/validation";
import { eventInputSchema, categoryInputSchema, addonInputSchema, sanitizeListFields, coordPairError, kitCutoffError, comingSoonPublicationError, eventCapacityError, EVENT_STATUSES } from "@/lib/validation";
import { reconcileChildren } from "@/lib/reconcile-children";

const GENERIC_ERROR = "Something went wrong. Please try again.";
const WAIVER_PUBLISH_ERROR = "Publish an organizer waiver and assign it to this event before opening registration.";
const eventSaveError = (error: { code?: string; message?: string } | null) => {
  if (error?.message?.includes("event_waiver_required_for_publishing")) return WAIVER_PUBLISH_ERROR;
  if (error?.code === "23505" && error.message?.includes("events_slug_unique")) return "That public link is already in use. Choose another one.";
  if (error?.message?.includes("event_slug_locked")) return "The public link cannot be changed after the event is published.";
  return GENERIC_ERROR;
};

// ---- Draft shapes, ported verbatim from the old lib/eventWrites.ts -------

export type CategoryDraft = {
  id?: string; tempId?: string; code: string; label: string; distance_km: number | null; base_price: number; slots_total: number;
  elevation_gain_m: number | null; cutoff_hours: number | null; blurb: string | null;
};
export type AddonDraft = { id?: string; tempId?: string; name: string; price: number };
export type EventDraft = {
  id?: string; org_id: string; name: string; slug: string;
  city_psgc_code: string | null; region_name: string | null; province_name: string | null; city_name: string | null; venue: string | null;
  event_date: string | null; end_date: string | null; flag_off: string | null; status: string; discipline: EventDiscipline;
  coming_soon_notify_enabled: boolean; coming_soon_reserve_enabled: boolean;
  reservation_fee_cents: number | null; reservation_deadline_at: string | null; total_event_slots: number | null;
  check_in_required: boolean;
  registration_closes_at: string | null; kit_edit_closes_at: string | null;
  elevation_gain_m: number | null; cutoff_hours: number | null; description: string | null;
  start_lat: number | null; start_lng: number | null; finish_lat: number | null; finish_lng: number | null;
  route: RoutePoint[] | null;
  hero_image_url: string | null; gallery: string[]; schedule: ScheduleItem[]; inclusions: string[];
};

const EVENT_COLS = (e: EventDraft) => ({
  org_id: e.org_id, name: e.name, slug: e.slug,
  city_psgc_code: e.city_psgc_code, region_name: e.region_name, province_name: e.province_name, city_name: e.city_name, venue: e.venue,
  event_date: e.event_date, end_date: e.end_date, flag_off: e.flag_off, status: e.status, discipline: e.discipline,
  coming_soon_notify_enabled: e.coming_soon_notify_enabled, coming_soon_reserve_enabled: e.coming_soon_reserve_enabled,
  reservation_fee_cents: e.reservation_fee_cents, reservation_deadline_at: e.reservation_deadline_at,
  total_event_slots: e.total_event_slots,
  check_in_required: e.check_in_required,
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
 * `roles.isAdmin` (lib/queries/roles.ts) is true for super_admin OR a
 * resolved row that holds the `manage_org` capability (admin or editor) —
 * exactly this set. It is NOT `!!resolvedRow`: resolvedRow now also matches
 * a marshal row (marshal needs a resolved org to reach /check-in — see that
 * file's "Marshal last" comment), so `isAdmin` is defined via `manage_org`
 * specifically to keep marshal out of it. `roles.orgId` is the org
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
  const comingSoonError = comingSoonPublicationError({ ...parsed.data, status: sanitized.status as "coming_soon" });
  if (comingSoonError) return { error: comingSoonError };
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
  const capacityError = eventCapacityError(sanitized, payload.categories.current);
  if (capacityError) return { error: capacityError };
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
  let currentTotalSlots: number | null = null;
  if (eventId) {
    const cur = await supabase.from("events").select("status,check_in_required,slug,slug_locked_at,total_event_slots").eq("id", eventId).single();
    if (cur.error) {
      console.error("[events] event status lookup failed", { eventId, error: cur.error });
      return { error: GENERIC_ERROR };
    }
    currentStatus = cur.data.status;
    currentTotalSlots = cur.data.total_event_slots;
    if (currentTotalSlots != null && sanitized.total_event_slots === null && sanitized.status !== "draft") {
      return { error: "A published event must keep its total event slots." };
    }
    if ((currentStatus !== "draft" || cur.data.slug_locked_at) && cur.data.slug && sanitized.slug !== cur.data.slug) {
      return { error: "The public link cannot be changed after the event is published." };
    }
    if (cur.data.check_in_required !== sanitized.check_in_required && !roles?.isOrgAdmin) {
      return { error: "Only organization admins can change event check-in." };
    }
  } else if (!roles?.isOrgAdmin) {
    const org = await supabase.from("organizations").select("check_in_required_default").eq("id", sanitized.org_id).single();
    if (org.error || org.data?.check_in_required_default !== sanitized.check_in_required) {
      return { error: "Only organization admins can change event check-in." };
    }
  }
  const statusOk = sanitized.status === "cancelled"
    ? currentStatus === "cancelled"
    : (EVENT_STATUSES as readonly string[]).includes(sanitized.status);
  if (!statusOk) {
    return { error: "Fix the event fields (invalid status)." };
  }
  if ((sanitized.status === "open" || sanitized.status === "almost_full") &&
    sanitized.total_event_slots === null && (!eventId || currentStatus === "coming_soon")) {
    return { error: "Set total event slots before opening registration." };
  }

  const event: EventDraft = { ...sanitized, id: eventId };
  // An early reservation promises an event place, while categories can be
  // configured only when registration opens. Save the category rows first so
  // the database can verify their combined capacity at the status change.
  const deferredOpening = currentStatus === "coming_soon" &&
    (event.status === "open" || event.status === "almost_full");
  const deferredCapacityUpdate = !!eventId && event.total_event_slots !== null &&
    (currentTotalSlots === null || event.total_event_slots < currentTotalSlots);

  let finalEventId = eventId;
  if (!finalEventId) {
    const ins = await supabase.from("events").insert(EVENT_COLS(event)).select("id").single();
    if (ins.error) {
      console.error("[events] event insert failed", { orgId: event.org_id, error: ins.error });
      return { error: eventSaveError(ins.error) };
    }
    finalEventId = ins.data!.id;
  } else {
    // .select("id") + the empty-result check matter here: an UPDATE blocked
    // by RLS (rather than by the grant) does not raise an error — it
    // silently affects zero rows. assertCanWriteEvent above is what actually
    // prevents that in the normal case; this is the honest-response check
    // for when it's ever wrong (stale roles cache, org reassignment, etc.).
    const upd = await supabase.from("events").update(EVENT_COLS({
      ...event, status: deferredOpening ? "coming_soon" : event.status,
      total_event_slots: deferredCapacityUpdate ? currentTotalSlots : event.total_event_slots,
    })).eq("id", finalEventId).select("id");
    if (upd.error) {
      console.error("[events] event update failed", { eventId: finalEventId, error: upd.error });
      return { error: eventSaveError(upd.error) };
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
  // Free places before allocating them elsewhere. The database checks every
  // intermediate category write against the event total, including direct API writes.
  for (const id of cat.toDelete) {
    const r = await supabase.from("categories").delete().eq("id", id).eq("event_id", finalEventId);
    if (r.error) childErrors.push(`Couldn't remove a category — it has registrations.`);
  }
  let currentCategorySlots = new Map<string, number>();
  if (event.total_event_slots !== null && cat.toUpdate.length) {
    const rows = await supabase.from("categories").select("id,slots_total").eq("event_id", finalEventId);
    if (rows.error) {
      console.error("[events] category capacity lookup failed", { eventId: finalEventId, error: rows.error });
      childErrors.push("Category capacity could not be checked. Please try again.");
    } else {
      currentCategorySlots = new Map((rows.data ?? []).map((row) => [row.id, row.slots_total]));
    }
  }
  const orderedUpdates = [...cat.toUpdate].sort((a, b) =>
    (a.slots_total - (currentCategorySlots.get(a.id ?? "") ?? a.slots_total)) -
    (b.slots_total - (currentCategorySlots.get(b.id ?? "") ?? b.slots_total)));
  for (const c of childErrors.length ? [] : orderedUpdates) {
    const r = await supabase.from("categories").update({ code: c.code, label: c.label, distance_km: c.distance_km, base_price: c.base_price, slots_total: c.slots_total, elevation_gain_m: c.elevation_gain_m, cutoff_hours: c.cutoff_hours, blurb: c.blurb }).eq("id", c.id).eq("event_id", finalEventId);
    if (r.error) {
      console.error("[events] category update failed", { eventId: finalEventId, categoryId: c.id, error: r.error });
      childErrors.push(`Category "${c.label}" couldn't be saved.`);
    }
  }
  for (const c of childErrors.length ? [] : cat.toInsert) {
    const r = await supabase.from("categories").insert({ org_id: event.org_id, event_id: finalEventId, code: c.code, label: c.label, distance_km: c.distance_km, base_price: c.base_price, slots_total: c.slots_total, elevation_gain_m: c.elevation_gain_m, cutoff_hours: c.cutoff_hours, blurb: c.blurb });
    if (r.error) {
      console.error("[events] category insert failed", { eventId: finalEventId, code: c.code, error: r.error });
      childErrors.push(`Category "${c.label}" couldn't be saved.`);
    }
  }

  if (deferredCapacityUpdate && !childErrors.length) {
    const capacity = await supabase.from("events").update({ total_event_slots: event.total_event_slots })
      .eq("id", finalEventId).select("id");
    if (capacity.error || !capacity.data?.length) {
      console.error("[events] event capacity update failed", { eventId: finalEventId, error: capacity.error });
      childErrors.push("Categories were saved, but total event slots could not be updated. Please try again.");
    }
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

  if (deferredOpening && !childErrors.length) {
    const opened = await supabase.from("events").update({ status: event.status })
      .eq("id", finalEventId).eq("status", "coming_soon").select("id");
    if (opened.error || !opened.data?.length) {
      console.error("[events] coming soon opening failed", { eventId: finalEventId, error: opened.error });
      childErrors.push("Categories were saved, but registration could not open. Check their total places and try again.");
    }
  }

  // Category and add-on prices are promises to every unpaid runner, not only
  // inputs for future registrations. The edge function closes each old
  // PayMongo session before replacing its amount, so the browser and provider
  // cannot disagree about what is chargeable.
  if (!childErrors.length && eventId) {
    const refreshed = await supabase.functions.invoke("reprice-event-checkouts", {
      body: { event_id: finalEventId },
    });
    if (refreshed.error) {
      console.error("[events] pending checkout repricing failed", { eventId: finalEventId, error: refreshed.error });
      childErrors.push("Prices were saved, but unpaid checkouts could not be refreshed. Please try saving again.");
    }
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
