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
import { saveEventAction, cancelEventAction, rescheduleEventAction, type EventDraft } from "./events";

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

function savePayload(event: Partial<EventDraft> = {}) {
  const fd = new FormData();
  fd.set("payload", JSON.stringify({
    event: baseEvent(event),
    categories: { current: [], original: [] },
    addons: { current: [], original: [] },
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

  it("inserts a new event, revalidates, and returns its id", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    from.mockReturnValue(chain({ data: { id: "e9" }, error: null }));
    const res = await saveEventAction({}, savePayload());
    expect(res.eventId).toBe("e9");
    expect(res.error).toBeUndefined();
    expect(revalidatePath).toHaveBeenCalledWith("/events");
    expect(revalidatePath).toHaveBeenCalledWith("/events/e9/edit");
  });

  it("reports failure, not success, when the update silently affects zero rows", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    from.mockReturnValue(chain({ data: [], error: null }));
    const res = await saveEventAction({}, savePayload({ id: "e1" }));
    expect(res.error).toBeTruthy();
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
});

describe("rescheduleEventAction", () => {
  const lookupOk = () => chain({ data: { org_id: "a1" }, error: null });

  it("shifts end_date by the same delta as the new start date for a multi-day event", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    const write = chain({ data: [{ id: "e1" }], error: null });
    from.mockReturnValueOnce(lookupOk()).mockReturnValueOnce(write);
    await rescheduleEventAction("e1", "2026-09-01", "2026-09-03", "2026-10-05", "moved");
    expect(write.update).toHaveBeenCalledWith({
      original_date: "2026-09-01", event_date: "2026-10-05", end_date: "2026-10-07", status_note: "moved",
    });
  });

  it("leaves end_date null for a single-day event", async () => {
    getMyRoles.mockResolvedValue(roles({}));
    const write = chain({ data: [{ id: "e1" }], error: null });
    from.mockReturnValueOnce(lookupOk()).mockReturnValueOnce(write);
    await rescheduleEventAction("e1", "2026-09-01", null, "2026-10-05", "");
    expect(write.update).toHaveBeenCalledWith({
      original_date: "2026-09-01", event_date: "2026-10-05", end_date: null, status_note: null,
    });
  });

  it("refuses a non-admin/editor caller without writing", async () => {
    getMyRoles.mockResolvedValue(roles({ isAdmin: false }));
    from.mockReturnValueOnce(lookupOk());
    const res = await rescheduleEventAction("e1", "2026-09-01", null, "2026-10-05", "");
    expect(res.error).toBeTruthy();
  });
});
