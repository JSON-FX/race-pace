import { describe, it, expect, vi } from "vitest";

const singleMock = vi.fn().mockResolvedValue({
  data: { id: "a1", name: "Muspo", logo_url: null, banner_url: null },
  error: null,
});
const eqMock = vi.fn(() => ({ single: singleMock }));
const selectMock = vi.fn(() => ({ eq: eqMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => ({ select: selectMock }) }),
}));

import { getOrg } from "./org";

describe("getOrg", () => {
  it("returns the org branding row for the given id", async () => {
    const org = await getOrg("a1");
    expect(org).toMatchObject({ id: "a1", name: "Muspo", logo_url: null, banner_url: null });
    expect(selectMock).toHaveBeenCalledWith("id,name,logo_url,banner_url");
    expect(eqMock).toHaveBeenCalledWith("id", "a1");
  });

  it("throws when the query errors", async () => {
    singleMock.mockResolvedValueOnce({ data: null, error: { message: "denied" } });
    await expect(getOrg("a1")).rejects.toBeTruthy();
  });
});
