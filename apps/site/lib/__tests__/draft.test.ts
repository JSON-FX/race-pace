import { describe, it, expect, beforeEach } from "vitest";
import { newDraft, loadDraft, saveDraft, clearDraft } from "../draft";

beforeEach(() => sessionStorage.clear());

describe("draft persistence", () => {
  it("returns null when nothing is stored", () => {
    expect(loadDraft("cat1")).toBeNull();
  });

  it("round-trips a draft", () => {
    const d = newDraft("cat1");
    d.step = 2;
    d.details.bib_name = "JUAN";
    d.addonIds = ["a1", "a2"];
    saveDraft("cat1", d);

    const loaded = loadDraft("cat1");
    expect(loaded?.step).toBe(2);
    expect(loaded?.details.bib_name).toBe("JUAN");
    expect(loaded?.addonIds).toEqual(["a1", "a2"]);
  });

  it("scopes drafts per category", () => {
    saveDraft("cat1", { ...newDraft("cat1"), step: 3 });
    expect(loadDraft("cat2")).toBeNull();
  });

  it("clears a draft", () => {
    saveDraft("cat1", newDraft("cat1"));
    clearDraft("cat1");
    expect(loadDraft("cat1")).toBeNull();
  });

  // THE critical guarantee. apps/mobile generates its key with
  // useState(() => `${categoryId}:${Date.now()}`), which on the web mints a
  // NEW key on every refresh — and the server's
  // onConflict:"user_id,idempotency_key" upsert then creates a SECOND
  // pending registration instead of reusing the first.
  it("keeps the idempotency key stable across a reload", () => {
    const first = newDraft("cat1");
    saveDraft("cat1", first);

    const afterReload = loadDraft("cat1");
    expect(afterReload!.idempotencyKey).toBe(first.idempotencyKey);
  });

  it("generates a distinct key per new draft", () => {
    expect(newDraft("cat1").idempotencyKey).not.toBe(newDraft("cat1").idempotencyKey);
  });

  it("generates a key long enough for the server schema", () => {
    // registrationInputSchema requires idempotency_key.min(8).
    expect(newDraft("cat1").idempotencyKey.length).toBeGreaterThanOrEqual(8);
  });

  it("returns null rather than throwing on corrupted storage", () => {
    sessionStorage.setItem("rp:draft:cat1", "{not json");
    expect(loadDraft("cat1")).toBeNull();
  });
});
