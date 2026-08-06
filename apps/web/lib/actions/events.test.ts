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
  // check ((start_lat is null) = (start_lng is null)). Client validation
  // already blocks this, but the Server Action is a public endpoint that
  // doesn't have to go through the client form.
  it("blocks a half-entered coordinate pair before any write", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    const res = await saveEventAction({}, savePayload({ start_lat: 6.7719, start_lng: null }));
    expect(res.error).toMatch(/start latitude and longitude/);
    expect(from).not.toHaveBeenCalled();
  });

  it("inserts a new event, revalidates, and returns its id", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    const insertChain = chain({ data: { id: "e9" }, error: null });
    const catsChain = chain({ data: [], error: null });
    const addonsChain = chain({ data: [], error: null });
    from.mockReturnValueOnce(insertChain).mockReturnValueOnce(catsChain).mockReturnValueOnce(addonsChain);
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
    const catsChain = chain({ data: [], error: null });
    const addonsChain = chain({ data: [], error: null });
    from.mockReturnValueOnce(statusChain).mockReturnValueOnce(updateChain).mockReturnValueOnce(catsChain).mockReturnValueOnce(addonsChain);
    const res = await saveEventAction({}, savePayload({ id: "e1", status: "cancelled" }));
    expect(res.error).toBeUndefined();
  });

  // Category/add-on deletes must be scoped to the event actually being
  // saved, not trusted from the client-supplied `original` array — RLS on
  // categories/addons only checks the PARENT EVENT's org, not that the row
  // belongs to THIS event, so a crafted/stale payload naming a category id
  // from a different event in the same org would otherwise be a valid
  // delete target.
  it("derives the categories/addons diff from a fresh DB query, not the client-supplied `original` array", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    const statusChain = chain({ data: { status: "draft" }, error: null });
    const updateChain = chain({ data: [{ id: "e1" }], error: null });
    // The server's authoritative view: event e1 actually has category "real-1".
    const catsChain = chain({ data: [{ id: "real-1" }], error: null });
    const addonsChain = chain({ data: [], error: null });
    const deleteChain = chain({ data: null, error: null });
    from.mockReturnValueOnce(statusChain).mockReturnValueOnce(updateChain).mockReturnValueOnce(catsChain).mockReturnValueOnce(addonsChain).mockReturnValueOnce(deleteChain);

    // The payload lies: it claims the event's original categories were
    // ["other-event-cat"] (belonging to some OTHER event in the same org)
    // and the current list is empty — if trusted, this would compute
    // "other-event-cat" as deleted. The real original ("real-1") isn't
    // mentioned by the payload at all.
    const res = await saveEventAction({}, savePayload({ id: "e1" }, {
      categories: { current: [], original: [{ id: "other-event-cat" }] },
    }));

    expect(res.error).toBeUndefined();
    // The delete that actually ran targeted "real-1" (the DB's real child),
    // not "other-event-cat" (the payload's claim) — and was scoped to e1.
    expect(deleteChain.delete).toHaveBeenCalled();
    expect(deleteChain.eq).toHaveBeenCalledWith("id", "real-1");
    expect(deleteChain.eq).toHaveBeenCalledWith("event_id", "e1");
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
