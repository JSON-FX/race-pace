import { describe, it, expect, vi } from "vitest";

const singleMock = vi.fn().mockResolvedValue({
  data: { id: "a1", name: "TrailNorth", description: null, home_city_psgc_code: null, home_city_name: null, home_province_name: null, home_region_name: null, logo_url: null, banner_url: null },
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
    expect(org).toMatchObject({ id: "a1", name: "TrailNorth", logo_url: null, banner_url: null });
    expect(selectMock).toHaveBeenCalledWith("id,name,description,home_city_psgc_code,home_city_name,home_province_name,home_region_name,logo_url,banner_url,featured_image_url,check_in_required_default");
    expect(eqMock).toHaveBeenCalledWith("id", "a1");
  });

  it("throws when the query errors", async () => {
    singleMock.mockResolvedValueOnce({ data: null, error: { message: "denied" } });
    await expect(getOrg("a1")).rejects.toBeTruthy();
  });
});
