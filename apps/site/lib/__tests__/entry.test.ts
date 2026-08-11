import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMyEntry } from "../entry";

/** A minimal stand-in for the `.from().select().eq().eq().in().maybeSingle()`
 *  chain registrations-checkout and this helper both walk. Only `maybeSingle`
 *  does anything — the rest exist to keep the chain callable and return the
 *  row (or null) the test hands it. */
function fakeDb(row: Record<string, unknown> | null): SupabaseClient {
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    maybeSingle: async () => ({ data: row }),
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

describe("fetchMyEntry", () => {
  it("returns null without querying when there is no signed-in user", async () => {
    // db would throw if touched — passing a fake that queries confirms the
    // early return, not just the final result.
    const db = fakeDb({ id: "r1", status: "paid", category_id: "c1", expires_at: null });
    expect(await fetchMyEntry(db, "e1", null)).toBeNull();
  });

  it("returns null when the runner holds no live registration for the event", async () => {
    const db = fakeDb(null);
    expect(await fetchMyEntry(db, "e1", "u1")).toBeNull();
  });

  it("surfaces a paid entry", async () => {
    const db = fakeDb({ id: "r1", status: "paid", category_id: "c1", expires_at: null });
    expect(await fetchMyEntry(db, "e1", "u1")).toEqual({
      id: "r1",
      status: "paid",
      categoryId: "c1",
      expiresAt: null,
    });
  });

  it("surfaces a pending entry whose hold has not expired yet", async () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const db = fakeDb({ id: "r1", status: "pending", category_id: "c1", expires_at: future });
    expect(await fetchMyEntry(db, "e1", "u1")).toEqual({
      id: "r1",
      status: "pending",
      categoryId: "c1",
      expiresAt: future,
    });
  });

  it("treats a pending entry past its expires_at as already gone — mirrors registrations-checkout's lazy check", async () => {
    // The 15-minute sweep is what actually deletes/expires the row in the
    // database; this helper cannot wait for it, so it has to reach the same
    // verdict early or the site offers "Finish payment" for an entry the
    // server has already stopped honouring.
    const past = new Date(Date.now() - 60_000).toISOString();
    const db = fakeDb({ id: "r1", status: "pending", category_id: "c1", expires_at: past });
    expect(await fetchMyEntry(db, "e1", "u1")).toBeNull();
  });

  it("does not apply the expiry rule to a paid entry", async () => {
    // expiresAt is only meaningful while status is "pending" per the type's
    // own contract — a paid row can carry a stale expires_at left over from
    // before capture, and that must not make the entry disappear.
    const past = new Date(Date.now() - 60_000).toISOString();
    const db = fakeDb({ id: "r1", status: "paid", category_id: "c1", expires_at: past });
    expect(await fetchMyEntry(db, "e1", "u1")).toEqual({
      id: "r1",
      status: "paid",
      categoryId: "c1",
      expiresAt: past,
    });
  });
});
