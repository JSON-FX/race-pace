import { describe, expect, it, vi } from "vitest";
import { checkOrganizerInquiryRateLimit, inquiryClientIp, saltedRateLimitHash } from "./inquiryRateLimit.ts";

const salt = "a-strong-rate-limit-salt-with-32-bytes";

describe("organizer inquiry rate limiting", () => {
  it("hashes normalized identifiers without storing their raw value", async () => {
    const hash = await saltedRateLimitHash(salt, "email", " Runner@Example.com ");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain("runner@example.com");
    await expect(saltedRateLimitHash(salt, "email", "runner@example.com")).resolves.toBe(hash);
  });

  it("consumes independent IP and email limits", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    await expect(checkOrganizerInquiryRateLimit({
      client: { rpc }, salt, ipAddress: "203.0.113.8", email: "runner@example.com",
    })).resolves.toEqual({ ok: true });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_limit: 5, p_window_seconds: 3600 });
    expect(rpc.mock.calls[1][1]).toMatchObject({ p_limit: 3, p_window_seconds: 3600 });
  });

  it("stops when the IP limit is exhausted and fails closed on storage errors", async () => {
    const denied = vi.fn().mockResolvedValue({ data: false, error: null });
    await expect(checkOrganizerInquiryRateLimit({
      client: { rpc: denied }, salt, ipAddress: "203.0.113.8", email: "runner@example.com",
    })).resolves.toEqual({ ok: false, reason: "ip" });
    expect(denied).toHaveBeenCalledTimes(1);

    const failed = vi.fn().mockResolvedValue({ data: null, error: { message: "db unavailable" } });
    await expect(checkOrganizerInquiryRateLimit({
      client: { rpc: failed }, salt, ipAddress: "203.0.113.8", email: "runner@example.com",
    })).rejects.toThrow("rate_limit_unavailable");
  });

  it("prefers the provider-derived client address", () => {
    expect(inquiryClientIp(new Headers({ "cf-connecting-ip": "203.0.113.8", "x-forwarded-for": "198.51.100.3" }))).toBe("203.0.113.8");
    expect(inquiryClientIp(new Headers({ "x-forwarded-for": "198.51.100.3, 10.0.0.1" }))).toBe("198.51.100.3");
  });
});
