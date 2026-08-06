import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("browser-image-compression", () => ({ default: (f: File) => Promise.resolve(f) }));

const uploadMock = vi.fn().mockResolvedValue({ error: null });
const getPublicUrlMock = vi.fn(() => ({ data: { publicUrl: "https://cdn.test/org-images/a1/avatar-x.png" } }));
const updateEq = vi.fn().mockResolvedValue({ error: null });
const updateMock = vi.fn(() => ({ eq: updateEq }));
const singleMock = vi.fn().mockResolvedValue({ data: { id: "a1", name: "Muspo", logo_url: null, banner_url: null }, error: null });
vi.mock("../lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ single: singleMock }) }), update: updateMock }),
    storage: { from: () => ({ upload: uploadMock, getPublicUrl: getPublicUrlMock }) },
  },
}));

import { useMyOrg, uploadOrgImage, updateOrgBranding } from "../lib/org";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

it("useMyOrg returns the org branding row", async () => {
  const { result } = renderHook(() => useMyOrg("a1"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toBeTruthy());
  expect(result.current.data).toMatchObject({ id: "a1", name: "Muspo", logo_url: null });
});

it("uploadOrgImage uploads under {orgId}/{kind}-… and returns the URL", async () => {
  const blob = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
  const url = await uploadOrgImage("a1", blob, "avatar");
  const path = uploadMock.mock.calls[0]![0] as string;
  expect(path).toMatch(/^a1\/avatar-.+\.png$/);
  expect(url).toBe("https://cdn.test/org-images/a1/avatar-x.png");
});

it("updateOrgBranding updates organizations by id and succeeds", async () => {
  const res = await updateOrgBranding("a1", { logo_url: "https://cdn/x.png" });
  expect(res.ok).toBe(true);
  expect(updateMock).toHaveBeenCalledWith({ logo_url: "https://cdn/x.png" });
  expect(updateEq).toHaveBeenCalledWith("id", "a1");
});

it("updateOrgBranding surfaces an error", async () => {
  updateEq.mockResolvedValueOnce({ error: { message: "denied" } });
  const res = await updateOrgBranding("a1", { banner_url: "u" });
  expect(res.ok).toBe(false);
  expect(res.error).toBe("denied");
});
