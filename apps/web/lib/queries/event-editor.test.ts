import { describe, it, expect, vi } from "vitest";

// A tiny chainable query-builder stand-in (same shape as the one in
// lib/actions/events.test.ts): every method returns the same object so any
// call order works, and the object is itself thenable so a chain that ends
// without `.single()` (the categories/addons queries below) still resolves
// when awaited.
function chain(result: unknown) {
  const b: Record<string, unknown> = {};
  b.select = vi.fn(() => b);
  b.eq = vi.fn(() => b);
  b.order = vi.fn(() => b);
  b.single = vi.fn(() => Promise.resolve(result));
  (b as unknown as { then: unknown }).then = (resolve: (v: unknown) => void) => resolve(result);
  return b;
}

const eventsChain = chain({ data: { id: "e1", org_id: "a1", name: "Apo Sky Ultra" }, error: null });
const categoriesChain = chain({ data: [], error: null });
const addonsChain = chain({ data: [], error: null });

const from = vi.fn((table: string) => {
  if (table === "events") return eventsChain;
  if (table === "categories") return categoriesChain;
  return addonsChain;
});

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }));

import { getEventForEditor } from "./event-editor";

describe("getEventForEditor", () => {
  // EVENT_SELECT is a hand-maintained column-list string, not derived from
  // EditorEvent or any shared const, so TypeScript can't catch a column
  // silently going missing from it — a deleted column here is still a
  // perfectly valid string. This is a blunt string-content assertion (it
  // doesn't prove Postgres actually returns the column), but it's the only
  // thing standing between a silent regression here and production: the
  // round-trip tests in event-editor-form.test.tsx build an EditorData
  // object by hand and pass it straight in as the `initial` prop — they
  // never call getEventForEditor, so they never touch this string either.
  it("requests registration_closes_at and kit_edit_closes_at in the events SELECT", async () => {
    await getEventForEditor("e1");
    const selectMock = eventsChain.select as ReturnType<typeof vi.fn>;
    expect(selectMock).toHaveBeenCalledTimes(1);
    const selectArg = selectMock.mock.calls[0][0] as string;
    expect(selectArg).toContain("registration_closes_at");
    expect(selectArg).toContain("kit_edit_closes_at");
  });
});
