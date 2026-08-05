import { describe, it, expect, beforeEach, vi } from "vitest";

// checkin.ts imports ./supabase, which calls createClient(url, key) at MODULE SCOPE.
// Under vitest the VITE_* env vars are undefined and supabase-js throws
// "supabaseUrl is required", so this mock is mandatory even though the test
// only uses the pure bannerFor mapper.
vi.mock("../lib/supabase", () => ({ supabase: {} }));

import {
  EMPTY_STORE, storageKey, loadStore, saveStore, offlineDecision,
  enqueue, markReplayed, markFailed, retryFailed, progress, unsentCount, SELECTED_EVENT_KEY,
  type CheckInStore, type RosterRow,
} from "../lib/checkinQueue";
import { bannerFor } from "../lib/checkin";

const row = (over: Partial<RosterRow> = {}): RosterRow => ({
  registration_id: "r1", ticket_token: "tok1", runner: "Ana Cruz",
  bib: "ANA", category: "10K", status: "paid", checked_in_at: null, ...over,
});

const store = (over: Partial<CheckInStore> = {}): CheckInStore => ({
  ...EMPTY_STORE, roster: [row()], ...over,
});

describe("offlineDecision", () => {
  it("accepts a paid, unscanned ticket", () => {
    const res = offlineDecision("tok1", store());
    expect(res).toEqual({ status: 200, body: { ok: true, registration_id: "r1" } });
    expect(bannerFor(res).tone).toBe("success");
  });

  it("reports an unknown token as not_found", () => {
    const res = offlineDecision("nope", store());
    expect(res.body.error).toBe("not_found");
    expect(bannerFor(res).tone).toBe("error");
  });

  it("reports a pending registration as not_paid, not not_found", () => {
    const res = offlineDecision("tok1", store({ roster: [row({ status: "pending" })] }));
    expect(res.body.error).toBe("not_paid");
    expect(bannerFor(res).title).toBe("Not paid");
  });

  it("reports an already-checked-in runner as already", () => {
    const res = offlineDecision("tok1", store({ roster: [row({ checked_in_at: "2026-08-06T01:00:00Z" })] }));
    expect(res.body).toMatchObject({ ok: true, already: true });
    expect(bannerFor(res).tone).toBe("muted");
  });

  it("treats a second scan of a queued token as already, not a duplicate enqueue", () => {
    const s = enqueue(store(), row(), "tok1", "c1", "2026-08-06T01:00:00Z");
    const res = offlineDecision("tok1", s);
    expect(res.body).toMatchObject({ ok: true, already: true });
  });
});

describe("queue reducer", () => {
  it("enqueue adds one entry carrying the runner's name for the failed list", () => {
    const s = enqueue(store(), row(), "tok1", "c1", "2026-08-06T01:00:00Z");
    expect(s.queue).toHaveLength(1);
    expect(s.queue[0]!).toEqual({
      clientId: "c1", ticketToken: "tok1", registrationId: "r1",
      runner: "Ana Cruz", category: "10K", scannedAt: "2026-08-06T01:00:00Z",
    });
  });

  it("markReplayed drops the entry and stamps the roster row", () => {
    let s = enqueue(store(), row(), "tok1", "c1", "2026-08-06T01:00:00Z");
    s = markReplayed(s, "c1", "2026-08-06T02:00:00Z");
    expect(s.queue).toHaveLength(0);
    expect(s.failed).toHaveLength(0);
    expect(s.roster[0]?.checked_in_at).toBe("2026-08-06T02:00:00Z");
  });

  it("markFailed moves the entry to failed with a human reason", () => {
    let s = enqueue(store(), row(), "tok1", "c1", "2026-08-06T01:00:00Z");
    s = markFailed(s, "c1", "Not paid", 409, "2026-08-06T02:00:00Z");
    expect(s.queue).toHaveLength(0);
    expect(s.failed).toHaveLength(1);
    expect(s.failed[0]!).toMatchObject({ clientId: "c1", runner: "Ana Cruz", reason: "Not paid", httpStatus: 409 });
    expect(s.roster[0]?.checked_in_at).toBeNull();
  });

  it("retryFailed moves it back to the queue", () => {
    let s = enqueue(store(), row(), "tok1", "c1", "2026-08-06T01:00:00Z");
    s = markFailed(s, "c1", "Not paid", 409, "2026-08-06T02:00:00Z");
    s = retryFailed(s, "c1");
    expect(s.failed).toHaveLength(0);
    expect(s.queue).toHaveLength(1);
    expect(s.queue[0]).not.toHaveProperty("reason");
  });
});

describe("progress", () => {
  it("counts only paid runners and never double-counts a queued scan", () => {
    const roster = [
      row({ registration_id: "r1", ticket_token: "t1", checked_in_at: "2026-08-06T01:00:00Z" }),
      row({ registration_id: "r2", ticket_token: "t2" }),
      row({ registration_id: "r3", ticket_token: "t3" }),
      row({ registration_id: "r4", ticket_token: "t4", status: "pending" }),
    ];
    let s: CheckInStore = { ...EMPTY_STORE, roster };
    expect(progress(s)).toEqual({ done: 1, total: 3 });

    s = enqueue(s, roster[1]!, "t2", "c2", "2026-08-06T01:05:00Z");
    expect(progress(s)).toEqual({ done: 2, total: 3 });

    s = markReplayed(s, "c2", "2026-08-06T01:06:00Z");
    expect(progress(s)).toEqual({ done: 2, total: 3 });
  });
});

describe("storage", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a store", () => {
    const s = enqueue(store(), row(), "tok1", "c1", "2026-08-06T01:00:00Z");
    expect(saveStore("e1", s).ok).toBe(true);
    expect(loadStore("e1")).toEqual(s);
  });

  it("returns an empty store for an unknown event and for corrupt JSON", () => {
    expect(loadStore("missing")).toEqual(EMPTY_STORE);
    localStorage.setItem(storageKey("e2"), "{not json");
    expect(loadStore("e2")).toEqual(EMPTY_STORE);
  });

  it("surfaces a quota failure instead of throwing", () => {
    const original = localStorage.setItem;
    localStorage.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
    const res = saveStore("e3", store());
    localStorage.setItem = original;
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/storage/i);
  });
});

describe("unsentCount", () => {
  beforeEach(() => localStorage.clear());

  it("is zero when nothing is persisted", () => {
    expect(unsentCount()).toBe(0);
  });

  it("sums queue + failed across every event's store, ignoring the selected-event pointer", () => {
    const withQueue = enqueue(store(), row(), "tok1", "c1", "2026-08-06T01:00:00Z");
    let withFailed = enqueue(store(), row({ registration_id: "r2", ticket_token: "tok2" }), "tok2", "c2", "2026-08-06T01:00:00Z");
    withFailed = markFailed(withFailed, "c2", "Not paid", 409, "2026-08-06T02:00:00Z");
    withFailed = enqueue(withFailed, row({ registration_id: "r3", ticket_token: "tok3" }), "tok3", "c3", "2026-08-06T01:00:00Z");

    saveStore("e1", withQueue);   // 1 queued
    saveStore("e2", withFailed);  // 1 queued + 1 failed
    localStorage.setItem(SELECTED_EVENT_KEY, "e2"); // not a store — must not be parsed as one

    expect(unsentCount()).toBe(3);
  });

  it("skips a corrupt entry rather than throwing", () => {
    const withQueue = enqueue(store(), row(), "tok1", "c1", "2026-08-06T01:00:00Z");
    saveStore("e1", withQueue);
    localStorage.setItem(storageKey("e2"), "{not json");

    expect(unsentCount()).toBe(1);
  });
});
