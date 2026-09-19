import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const originalSiteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

beforeEach(() => {
  vi.resetModules();
  process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = "public-site-key";
  window.grecaptcha = undefined;
});

afterEach(() => {
  process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY = originalSiteKey;
});

describe("getOrganizerInquiryCaptchaToken", () => {
  it("executes the organizer action after Google reports ready", async () => {
    const execute = vi.fn().mockResolvedValue("assessment-token");
    window.grecaptcha = { enterprise: { ready: (callback) => callback(), execute } };
    const { getOrganizerInquiryCaptchaToken } = await import("../recaptcha");

    await expect(getOrganizerInquiryCaptchaToken()).resolves.toBe("assessment-token");
    expect(execute).toHaveBeenCalledWith("public-site-key", { action: "organizer_inquiry" });
  });

  it("fails closed when the public site key is missing", async () => {
    delete process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
    const { getOrganizerInquiryCaptchaToken } = await import("../recaptcha");

    await expect(getOrganizerInquiryCaptchaToken()).rejects.toThrow("recaptcha_not_configured");
  });

  it("propagates an execution failure", async () => {
    window.grecaptcha = {
      enterprise: {
        ready: (callback) => callback(),
        execute: vi.fn().mockRejectedValue(new Error("provider_failed")),
      },
    };
    const { getOrganizerInquiryCaptchaToken } = await import("../recaptcha");

    await expect(getOrganizerInquiryCaptchaToken()).rejects.toThrow("provider_failed");
  });
});
