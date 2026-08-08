import { describe, it, expect, vi, beforeEach } from "vitest";

// A dedicated mock (rather than reusing registrations-emails.test.ts's or
// registrations-aggregates.test.ts's, both shaped around the main list
// query's `.select().eq().order().range()` chain) because
// getRegistrationAddons' own chain ends in `.in()`, not `.range()`.
const inMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        in: inMock,
      }),
    }),
  }),
}));

import { getRegistrationAddons } from "./registrations";

beforeEach(() => {
  inMock.mockReset();
});

describe("getRegistrationAddons", () => {
  it("groups add-ons by registration id, unwrapping the addons(name) join", async () => {
    inMock.mockResolvedValue({
      data: [
        { registration_id: "r1", price: 60000, addons: { name: "Singlet" } },
        { registration_id: "r1", price: 15000, addons: { name: "Finisher medal" } },
        { registration_id: "r2", price: 20000, addons: null },
      ],
      error: null,
    });

    const byId = await getRegistrationAddons(["r1", "r2"]);

    expect(byId.get("r1")).toEqual([
      { name: "Singlet", price: 60000 },
      { name: "Finisher medal", price: 15000 },
    ]);
    expect(byId.get("r2")).toEqual([{ name: null, price: 20000 }]);
  });

  // This is the guarantee that used to be asserted from RegistrationDetail's
  // own test, back when it fetched add-ons itself from the browser. Now that
  // the read happens here, the degrade-on-failure behaviour belongs here too
  // — the component only ever sees the already-degraded `row.addons`.
  it("degrades to an empty Map, not a thrown error, when the query fails", async () => {
    inMock.mockResolvedValue({ data: null, error: { message: "nope" } });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const byId = await getRegistrationAddons(["r1"]);
    errorSpy.mockRestore();

    expect(byId).toEqual(new Map());
  });

  it("skips the query entirely for an empty id list", async () => {
    const byId = await getRegistrationAddons([]);

    expect(byId).toEqual(new Map());
    expect(inMock).not.toHaveBeenCalled();
  });
});
