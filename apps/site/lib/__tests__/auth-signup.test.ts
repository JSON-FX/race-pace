import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeNextPath } from "../routes";
import { signUpWithPassword } from "../auth";
const signUp = vi.fn();
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signUp } }) }));
beforeEach(() => { vi.clearAllMocks(); });
describe("signup confirmation", () => {
  it("requests callback and preserves a safe destination when confirmation is needed", async () => {
    signUp.mockResolvedValue({ data: { session: null }, error: null });
    expect(await signUpWithPassword(" runner@example.com ", "password123", "/races")).toEqual({ confirmationRequired: true });
    expect(signUp).toHaveBeenCalledWith({ email: "runner@example.com", password: "password123", options: { emailRedirectTo: "http://localhost:3000/auth/callback" } });
    expect(document.cookie).toContain("rp_oauth_next=%2Fraces");
  });
  it("distinguishes an immediate session and rejects an external destination", async () => {
    signUp.mockResolvedValue({ data: { session: { user: {} } }, error: null });
    expect(await signUpWithPassword("runner@example.com", "password123", "//evil.example")).toEqual({ confirmationRequired: false });
    expect(document.cookie).toContain("rp_oauth_next=%2F");
  });
  it("reports provider and transport errors", async () => {
    signUp.mockResolvedValue({ data: {}, error: { message: "Too many requests" } });
    expect(await signUpWithPassword("r@example.com", "password123")).toEqual({ error: "Too many requests" });
    signUp.mockRejectedValue(new Error("network"));
    expect((await signUpWithPassword("r@example.com", "password123")).error).toContain("try again");
  });
});

it.each(["/\n/evil.example", "/\t/evil.example", "/path\\evil.example"])("rejects browser-normalized unsafe redirect %j", (path) => { expect(safeNextPath(path)).toBe("/"); });
