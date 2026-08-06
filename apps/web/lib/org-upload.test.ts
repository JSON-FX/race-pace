import { describe, it, expect, vi } from "vitest";

vi.mock("browser-image-compression", () => ({ default: (f: File) => Promise.resolve(f) }));

const uploadMock = vi.fn().mockResolvedValue({ error: null });
const getPublicUrlMock = vi.fn(() => ({ data: { publicUrl: "https://cdn.test/org-images/a1/avatar-x.png" } }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ storage: { from: () => ({ upload: uploadMock, getPublicUrl: getPublicUrlMock }) } }),
}));

import { uploadOrgImage } from "./org-upload";

describe("uploadOrgImage", () => {
  it("uploads under {orgId}/{kind}-{uuid}.{ext} and returns the public URL", async () => {
    const blob = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    const url = await uploadOrgImage("a1", blob, "avatar");
    const path = uploadMock.mock.calls[0]![0] as string;
    expect(path).toMatch(/^a1\/avatar-.+\.png$/);
    expect(url).toBe("https://cdn.test/org-images/a1/avatar-x.png");
  });

  it("uses the cover kind prefix for banner uploads", async () => {
    const blob = new File([new Uint8Array([1])], "b.png", { type: "image/png" });
    await uploadOrgImage("a1", blob, "cover");
    const path = uploadMock.mock.calls.at(-1)![0] as string;
    expect(path).toMatch(/^a1\/cover-.+\.png$/);
  });
});
