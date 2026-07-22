import { reconcileChildren, rescheduleEvent } from "../lib/eventWrites";

it("reconcile computes insert/update/delete by id", () => {
  const original = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const current = [{ id: "a", v: 1 }, { id: "c", v: 9 }, { tempId: "t1", v: 2 }];
  const r = reconcileChildren(original, current);
  expect(r.toInsert.map((x) => (x as { v: number }).v)).toEqual([2]);   // the temp row
  expect(r.toUpdate.map((x) => x.id).sort()).toEqual(["a", "c"]);        // present real ids
  expect(r.toDelete).toEqual(["b"]);                                     // original id no longer present
});

const updateMock = vi.fn((_patch: unknown) => ({ eq: () => Promise.resolve({ error: null }) }));
vi.mock("../lib/supabase", () => ({ supabase: { from: () => ({ update: (patch: unknown) => updateMock(patch) }) } }));

describe("rescheduleEvent", () => {
  beforeEach(() => updateMock.mockClear());

  it("shifts end_date by the same delta as the new start date for a multi-day event", async () => {
    await rescheduleEvent("e1", "2026-09-01", "2026-09-03", "2026-10-05", "moved");
    expect(updateMock).toHaveBeenCalledWith({
      original_date: "2026-09-01", event_date: "2026-10-05", end_date: "2026-10-07", status_note: "moved",
    });
  });

  it("leaves end_date null for a single-day event", async () => {
    await rescheduleEvent("e1", "2026-09-01", null, "2026-10-05", "");
    expect(updateMock).toHaveBeenCalledWith({
      original_date: "2026-09-01", event_date: "2026-10-05", end_date: null, status_note: null,
    });
  });
});
