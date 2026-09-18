import { beforeEach, describe, expect, it, vi } from "vitest";
const { auth, createBrowserClient } = vi.hoisted(() => ({
  auth: { exchangeCodeForSession: vi.fn(), verifyOtp: vi.fn(), setSession: vi.fn(), getUser: vi.fn() },
  createBrowserClient: vi.fn(),
}));
vi.mock("@supabase/ssr", () => ({ createBrowserClient }));
import { redeemRecoveryLink, createRecoveryClient } from "../recovery";
beforeEach(() => {
  vi.clearAllMocks();
  createBrowserClient.mockReturnValue({ auth });
  auth.exchangeCodeForSession.mockResolvedValue({ data: { redirectType: "recovery" }, error: null });
  auth.verifyOtp.mockResolvedValue({ error: null });
  auth.setSession.mockResolvedValue({ error: null });
  auth.getUser.mockResolvedValue({ data: { user: { id: "runner" } }, error: null });
});
describe("recovery redemption", () => {
  it("disables automatic URL redemption on an isolated client", () => {
    createRecoveryClient();
    expect(createBrowserClient).toHaveBeenCalledWith(undefined, undefined, { isSingleton: false, auth: { detectSessionInUrl: false, autoRefreshToken: false } });
  });
  it("never accepts an existing session without a link", async () => {
    expect(await redeemRecoveryLink(new URL("https://admin.test/auth/recovery"))).toBeNull();
    expect(auth.getUser).not.toHaveBeenCalled();
  });
  it("requires a recovery PKCE exchange", async () => {
    expect(await redeemRecoveryLink(new URL("https://admin.test/auth/recovery?code=one"))).not.toBeNull();
    auth.exchangeCodeForSession.mockResolvedValue({ data: { redirectType: null }, error: null });
    expect(await redeemRecoveryLink(new URL("https://admin.test/auth/recovery?code=two"))).toBeNull();
  });
  it("rejects reused or expired codes", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: {}, error: { message: "expired" } });
    expect(await redeemRecoveryLink(new URL("https://admin.test/auth/recovery?code=spent"))).toBeNull();
    expect(auth.getUser).not.toHaveBeenCalled();
  });
  it("accepts only recovery fragments", async () => {
    expect(await redeemRecoveryLink(new URL("https://admin.test/auth/recovery#type=invite&access_token=a&refresh_token=b"))).toBeNull();
    expect(auth.setSession).not.toHaveBeenCalled();
    expect(await redeemRecoveryLink(new URL("https://admin.test/auth/recovery#type=recovery&access_token=a&refresh_token=b"))).not.toBeNull();
  });
  it("verifies recovery hashes and then the user", async () => {
    expect(await redeemRecoveryLink(new URL("https://admin.test/auth/recovery?type=recovery&token_hash=hash"))).not.toBeNull();
    expect(auth.verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "hash" });
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await redeemRecoveryLink(new URL("https://admin.test/auth/recovery?type=recovery&token_hash=hash"))).toBeNull();
  });
});
