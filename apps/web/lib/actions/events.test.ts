import { describe, it, expect, vi, beforeEach } from "vitest";

// A tiny chainable query-builder stand-in. Each test configures the terminal
// method result (`select().single()`, `update().eq().select()`, etc.) it
// cares about; everything else defaults to a benign success so tests that
// don't touch a given table/step don't need to stub it.
function chain(result: unknown) {
  const b: Record<string, unknown> = {};
  b.select = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.single = vi.fn(() => Promise.resolve(result));
  b.insert = vi.fn(() => b);
  b.update = vi.fn(() => b);
  b.delete = vi.fn(() => b);
  // `.eq(...)` at the end of an update/delete chain (no trailing `.select()`)
  // must itself be awaitable — make the chain thenable so `await` on it
  // resolves to `result` directly.
  (b as unknown as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve(result);
  return b;
}

const { getMyRoles, from, revalidatePath } = vi.hoisted(() => ({
  getMyRoles: vi.fn(),
  from: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/queries/roles", () => ({ getMyRoles }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }));

import { reconcileChildren } from "@/lib/reconcile-children";
import { saveEventAction, cancelEventAction, rescheduleEventAction, type EventDraft, type CategoryDraft } from "./events";

function roles(overrides: Partial<{ isAdmin: boolean; isSuperAdmin: boolean; orgId: string | null }> = {}) {
  return { role: "admin", isSuperAdmin: false, isAdmin: true, isOrgAdmin: true, orgId: "a1", ...overrides };
}

function baseEvent(overrides: Partial<EventDraft> = {}): EventDraft {
  return {
    org_id: "a1", name: "Apo Sky Ultra", city_psgc_code: null, region_name: null, province_name: null, city_name: null, venue: null,
    event_date: null, end_date: null, flag_off: null, status: "draft", discipline: "trail",
    registration_closes_at: null, kit_edit_closes_at: null,
    elevation_gain_m: null, cutoff_hours: null, start_lat: null, start_lng: null, finish_lat: null, finish_lng: null,
    route: null, description: null, hero_image_url: null, gallery: [], schedule: [], inclusions: [],
    ...overrides,
  };
}

function savePayload(event: Partial<EventDraft> = {}, children: {
  categories?: { current: CategoryDraft[]; original: { id?: string }[] };
  addons?: { current: { id?: string; tempId?: string; name: string; price: number }[]; original: { id?: string }[] };
} = {}) {
  const fd = new FormData();
  fd.set("payload", JSON.stringify({
    event: baseEvent(event),
    categories: children.categories ?? { current: [], original: [] },
    addons: children.addons ?? { current: [], original: [] },
  }));
  return fd;
}

beforeEach(() => {
  getMyRoles.mockReset();
  from.mockReset();
  revalidatePath.mockClear();
});

describe("reconcileChildren", () => {
  it("computes insert/update/delete by id", () => {
    const original = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const current = [{ id: "a", v: 1 }, { id: "c", v: 9 }, { tempId: "t1", v: 2 }];
    const r = reconcileChildren(original, current);
    expect(r.toInsert.map((x) => (x as { v: number }).v)).toEqual([2]); // the temp row
    expect(r.toUpdate.map((x) => x.id).sort()).toEqual(["a", "c"]); // present real ids
    expect(r.toDelete).toEqual(["b"]); // original id no longer present
  });
});

describe("saveEventAction", () => {
  it("refuses a non-admin/editor caller without touching the database", async () => {
    getMyRoles.mockResolvedValue(roles({ isAdmin: false }));
    const res = await saveEventAction({}, savePayload());
    expect(res.error).toBeTruthy();
    expect(from).not.toHaveBeenCalled();
  });

  // auth_can_admin_org(org_id) in the events RLS policies only admits a
  // caller with an admin/editor row in THAT org — an editor of org A must
  // not be able to write into org B by putting org_id: "B" in the payload.
  // Verified against supabase/migrations/20260721100000_events_write_rls.sql.
  it("refuses a payload whose org_id doesn't match the caller's resolved org", async () => {
    getMyRoles.mockResolvedValue(roles({ orgId: "other-org" }));
    const res = await saveEventAction({}, savePayload({ org_id: "a1" }));
    expect(res.error).toBeTruthy();
    expect(from).not.toHaveBeenCalled();
  });

  it("blocks an invalid draft (missing name) before any write", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    const res = await saveEventAction({}, savePayload({ name: "" }));
    expect(res.error).toMatch(/Fix the event fields/);
    expect(from).not.toHaveBeenCalled();
  });

  // events_start_coords_paired / events_finish_coords_paired
  // (supabase/migrations/20260806160000_event_course_coordinates.sql):
  // check ((start_lat is null) = (start_lng is null)), same for finish.
  // Client validation already blocks this, but the Server Action is a
  // public endpoint that doesn't have to go through the client form. All
  // four directions covered — a lat without a lng and vice versa, for both
  // the start and finish pair.
  it.each([
    ["start_lat", { start_lat: 6.7719, start_lng: null }, /start latitude and longitude/],
    ["start_lng", { start_lat: null, start_lng: 125.2794 }, /start latitude and longitude/],
    ["finish_lat", { finish_lat: 6.77, finish_lng: null }, /finish latitude and longitude/],
    ["finish_lng", { finish_lat: null, finish_lng: 125.28 }, /finish latitude and longitude/],
  ])("blocks a half-entered coordinate pair (%s set alone) before any write", async (_field, override, expected) => {
    getMyRoles.mockResolvedValue(roles({}));
    const res = await saveEventAction({}, savePayload(override));
    expect(res.error).toMatch(expected);
    expect(from).not.toHaveBeenCalled();
  });

  it("inserts a new event, revalidates, and returns its id", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    const insertChain = chain({ data: { id: "e9" }, error: null });
    from.mockReturnValueOnce(insertChain);
    const res = await saveEventAction({}, savePayload());
    expect(res.eventId).toBe("e9");
    expect(res.error).toBeUndefined();
    expect(revalidatePath).toHaveBeenCalledWith("/events");
    expect(revalidatePath).toHaveBeenCalledWith("/events/e9/edit");
  });

  it("reports failure, not success, when the update silently affects zero rows", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    const statusChain = chain({ data: { status: "draft" }, error: null });
    const updateChain = chain({ data: [], error: null });
    from.mockReturnValueOnce(statusChain).mockReturnValueOnce(updateChain);
    const res = await saveEventAction({}, savePayload({ id: "e1" }));
    expect(res.error).toBeTruthy();
  });

  // "cancelled" is outside eventInputSchema's status enum by design (it's
  // set only via the Cancel modal / cancelEventAction, which also records
  // status_note) — a forged Save payload must not be able to set it
  // directly and skip that note.
  it("refuses status: \"cancelled\" through Save when the event isn't already cancelled", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    const statusChain = chain({ data: { status: "open" }, error: null });
    from.mockReturnValueOnce(statusChain);
    const res = await saveEventAction({}, savePayload({ id: "e1", status: "cancelled" }));
    expect(res.error).toBeTruthy();
    // Only the status lookup ran — no update was attempted.
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("allows status: \"cancelled\" to round-trip through Save when the event is ALREADY cancelled", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    const statusChain = chain({ data: { status: "cancelled" }, error: null });
    const updateChain = chain({ data: [{ id: "e1" }], error: null });
    from.mockReturnValueOnce(statusChain).mockReturnValueOnce(updateChain);
    const res = await saveEventAction({}, savePayload({ id: "e1", status: "cancelled" }));
    expect(res.error).toBeUndefined();
  });

  // The diff itself still trusts the client-supplied `original` array —
  // ported verbatim from lib/eventWrites.ts, unchanged. What closes the
  // cross-event hole is `.eq("event_id", finalEventId)` on every
  // category/add-on write below: a delete/update naming a row id that
  // belongs to a DIFFERENT event (even one in the caller's own org, so RLS
  // alone wouldn't catch it) now matches zero rows instead of succeeding.
  // (An earlier version of this fix instead re-derived `original` from a
  // fresh DB query — that was reverted: it changes reconcileChildren's
  // semantics so that a second, stale tab's save can delete a category a
  // FIRST tab just added, since the DB now "knows about" it but the stale
  // tab's `current` doesn't. `.eq` alone has no such side effect.)
  it("scopes every category/add-on write to the event actually being saved, so a foreign row id is a no-op", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    const statusChain = chain({ data: { status: "draft" }, error: null });
    const updateChain = chain({ data: [{ id: "e1" }], error: null });
    // Zero rows matched: "other-event-cat" belongs to a different event, so
    // `.eq("id", "other-event-cat").eq("event_id", "e1")` matches nothing —
    // this is what actually stops the cross-event delete, not an error.
    const deleteChain = chain({ data: null, error: null });
    from.mockReturnValueOnce(statusChain).mockReturnValueOnce(updateChain).mockReturnValueOnce(deleteChain);

    // The payload claims the event's original categories were
    // ["other-event-cat"] — a category id belonging to some OTHER event in
    // the same org — and the current list is empty, so reconcileChildren
    // computes it as "no longer present" and a delete is attempted.
    const res = await saveEventAction({}, savePayload({ id: "e1" }, {
      categories: { current: [], original: [{ id: "other-event-cat" }] },
    }));

    expect(res.error).toBeUndefined();
    expect(deleteChain.delete).toHaveBeenCalled();
    expect(deleteChain.eq).toHaveBeenCalledWith("id", "other-event-cat");
    // This is the actual fix under test: without it, the delete would only
    // be scoped by "id", and RLS (which checks the PARENT event's org, not
    // that the row belongs to THIS event) would let it through.
    expect(deleteChain.eq).toHaveBeenCalledWith("event_id", "e1");
  });

  // The concurrent-edit case this fix must NOT break: tab A adds category X
  // and saves; a stale tab B (whose `original` was captured before X
  // existed) saves next. Because `original` is trusted from B's OWN
  // payload rather than re-fetched from the DB, X is simply never a
  // candidate for `toDelete` — reconcileChildren only deletes ids present
  // in `original` and absent from `current`, and B's `original` never knew
  // X existed in the first place. No DB round trip is needed to prove this;
  // it falls out of reconcileChildren's definition once `original` is the
  // payload's, which is exactly what this test pins down: the action makes
  // no extra "what are this event's current categories" lookup at all.
  it("makes no extra DB lookup to re-derive `original` — a stale tab's save cannot see (or delete) another tab's newer category", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    const statusChain = chain({ data: { status: "draft" }, error: null });
    const updateChain = chain({ data: [{ id: "e1" }], error: null });
    const deleteChain = chain({ data: null, error: null });
    from.mockReturnValueOnce(statusChain).mockReturnValueOnce(updateChain).mockReturnValueOnce(deleteChain);

    // Tab B's `original` only ever knew about "b-cat" (captured on load,
    // before tab A added "a-cat"). B's `current` drops "b-cat" (the
    // organizer deleted it in tab B) — "a-cat" is not mentioned anywhere in
    // B's payload, because B never knew it existed.
    const res = await saveEventAction({}, savePayload({ id: "e1" }, {
      categories: { current: [], original: [{ id: "b-cat" }] },
    }));

    expect(res.error).toBeUndefined();
    // Exactly 3 calls total: status lookup, event update, the ONE delete
    // (for "b-cat", the row B's own payload named). No 4th call fetching
    // "what categories does e1 actually have" — that lookup is what would
    // have surfaced "a-cat" and put it at risk of deletion.
    expect(from).toHaveBeenCalledTimes(3);
    expect(deleteChain.eq).toHaveBeenCalledWith("id", "b-cat");
    expect(deleteChain.eq).not.toHaveBeenCalledWith("id", "a-cat");
  });
});

describe("cancelEventAction", () => {
  it("refuses a caller outside the event's org without writing", async () => {
    getMyRoles.mockResolvedValue(roles({ orgId: "other-org" }));
    from.mockReturnValue(chain({ data: { org_id: "a1" }, error: null }));
    const res = await cancelEventAction("e1", "weather");
    expect(res.error).toBeTruthy();
  });

  it("cancels for an authorized caller and revalidates", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    const lookup = chain({ data: { org_id: "a1" }, error: null });
    const write = chain({ data: [{ id: "e1" }], error: null });
    from.mockReturnValueOnce(lookup).mockReturnValueOnce(write);
    const res = await cancelEventAction("e1", "weather");
    expect(res.error).toBeUndefined();
    expect(write.update).toHaveBeenCalledWith({ status: "cancelled", status_note: "weather" });
    expect(revalidatePath).toHaveBeenCalledWith("/events");
  });

  it("logs the real Postgres error server-side on a failed lookup", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getMyRoles.mockResolvedValue(roles({}));
    from.mockReturnValueOnce(chain({ data: null, error: { message: "no rows" } }));
    const res = await cancelEventAction("e1", "weather");
    expect(res.error).toBeTruthy();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("[events]"), expect.anything());
    errorSpy.mockRestore();
  });
});

describe("rescheduleEventAction", () => {
  // event_date/end_date now come from the freshly-fetched row, not the
  // currentDate/currentEndDate arguments — those are accepted for a stable
  // call shape (RescheduleModal passes them) but deliberately ignored, so a
  // stale client can't feed a wrong "current" date into the end_date-shift
  // math or overwrite original_date with a value that was never current.
  const lookupOk = (eventDate: string | null, endDate: string | null) =>
    chain({ data: { org_id: "a1", event_date: eventDate, end_date: endDate }, error: null });

  it("shifts end_date by the same delta as the new start date for a multi-day event", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    const write = chain({ data: [{ id: "e1" }], error: null });
    from.mockReturnValueOnce(lookupOk("2026-09-01", "2026-09-03")).mockReturnValueOnce(write);
    // Pass mismatched currentDate/currentEndDate args — they must be ignored.
    await rescheduleEventAction("e1", "1999-01-01", "1999-01-01", "2026-10-05", "moved");
    expect(write.update).toHaveBeenCalledWith({
      original_date: "2026-09-01", event_date: "2026-10-05", end_date: "2026-10-07", status_note: "moved",
    });
  });

  it("leaves end_date null for a single-day event", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    const write = chain({ data: [{ id: "e1" }], error: null });
    from.mockReturnValueOnce(lookupOk("2026-09-01", null)).mockReturnValueOnce(write);
    await rescheduleEventAction("e1", "2026-09-01", null, "2026-10-05", "");
    expect(write.update).toHaveBeenCalledWith({
      original_date: "2026-09-01", event_date: "2026-10-05", end_date: null, status_note: null,
    });
  });

  it("refuses a non-admin/editor caller without writing", async () => {
    getMyRoles.mockResolvedValue(roles({ isAdmin: false }));
    from.mockReturnValueOnce(lookupOk("2026-09-01", null));
    const res = await rescheduleEventAction("e1", "2026-09-01", null, "2026-10-05", "");
    expect(res.error).toBeTruthy();
  });

  it("logs the real Postgres error server-side on a failed update", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getMyRoles.mockResolvedValue(roles({}));
    const write = chain({ data: null, error: { message: "boom" } });
    from.mockReturnValueOnce(lookupOk("2026-09-01", null)).mockReturnValueOnce(write);
    const res = await rescheduleEventAction("e1", "2026-09-01", null, "2026-10-05", "");
    expect(res.error).toBeTruthy();
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("[events]"), expect.anything());
    errorSpy.mockRestore();
  });
});
