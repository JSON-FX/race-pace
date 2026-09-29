import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
import { validateProofFile } from "../prescreening";
it("accepts the exact decimal 10 MB boundary for all three image formats", () => {
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    expect(validateProofFile(new File([new Uint8Array(10_000_000)], "proof", { type }))).toBeNull();
    expect(validateProofFile(new File([new Uint8Array(10_000_001)], "proof", { type }))).toContain("10 MB");
  }
});
it("rejects empty and unsupported uploads before network work", () => {
  expect(validateProofFile(new File([], "proof.png", { type: "image/png" }))).toContain("10 MB");
  expect(validateProofFile(new File(["<svg/>"], "proof.svg", { type: "image/svg+xml" }))).toContain("JPEG, PNG, or WebP");
});
