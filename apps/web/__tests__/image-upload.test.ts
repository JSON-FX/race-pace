import { describe, it, expect, vi, beforeEach } from "vitest";

const compressMock = vi.fn((file: File, _opts: unknown) => Promise.resolve(file));
vi.mock("browser-image-compression", () => ({ default: (file: File, opts: unknown) => compressMock(file, opts) }));

const uploadMock = vi.fn().mockResolvedValue({ error: null });
const getPublicUrlMock = vi.fn(() => ({ data: { publicUrl: "https://cdn.test/event-images/a1/x.png" } }));
vi.mock("../lib/supabase", () => ({
  supabase: { storage: { from: () => ({ upload: uploadMock, getPublicUrl: getPublicUrlMock }) } },
}));

import { compressImage, uploadEventImage } from "../lib/imageUpload";

function pngFile(name = "a.png") {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

beforeEach(() => { compressMock.mockClear(); uploadMock.mockClear(); });

describe("imageUpload", () => {
  it("compressImage passes the 3MB / 2000px worker options", async () => {
    await compressImage(pngFile());
    expect(compressMock).toHaveBeenCalledWith(expect.any(File), { maxSizeMB: 3, maxWidthOrHeight: 2000, useWebWorker: true });
  });

  it("uploadEventImage uploads under {orgId}/… and returns the public URL", async () => {
    const url = await uploadEventImage("a1", pngFile());
    expect(uploadMock).toHaveBeenCalled();
    const path = uploadMock.mock.calls[0]![0] as string;
    expect(path).toMatch(/^a1\/.+\.png$/);
    expect(url).toBe("https://cdn.test/event-images/a1/x.png");
  });

  it("rejects a non-image file before compressing", async () => {
    const txt = new File(["x"], "a.txt", { type: "text/plain" });
    await expect(uploadEventImage("a1", txt)).rejects.toThrow(/JPG, PNG, or WebP/);
    expect(compressMock).not.toHaveBeenCalled();
  });
});
