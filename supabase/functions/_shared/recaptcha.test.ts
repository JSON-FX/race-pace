import { describe, expect, it, vi } from "vitest";
import { recaptchaConfigFromEnv, verifyRecaptchaEnterprise, type RecaptchaConfig } from "./recaptcha.ts";

const config: RecaptchaConfig = {
  projectId: "race-pace",
  apiKey: "server-key",
  siteKey: "site-key",
  allowedHostnames: ["www.racepace.com.ph"],
  minimumScore: 0.7,
};

function provider(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), {
    status: ok ? 200 : 503,
    headers: { "content-type": "application/json" },
  }));
}

describe("verifyRecaptchaEnterprise", () => {
  it("accepts a valid assessment for the expected action and hostname", async () => {
    const fetcher = provider({
      tokenProperties: { valid: true, action: "organizer_inquiry", hostname: "www.racepace.com.ph" },
      riskAnalysis: { score: 0.9 },
    });

    await expect(verifyRecaptchaEnterprise("x".repeat(20), "organizer_inquiry", config, fetcher)).resolves.toEqual({ ok: true });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ event: { token: "x".repeat(20), siteKey: "site-key" } });
  });

  it.each([
    [{ tokenProperties: { valid: false } }, "invalid"],
    [{ tokenProperties: { valid: true, action: "wrong", hostname: "www.racepace.com.ph" }, riskAnalysis: { score: 0.9 } }, "action"],
    [{ tokenProperties: { valid: true, action: "organizer_inquiry", hostname: "evil.example" }, riskAnalysis: { score: 0.9 } }, "hostname"],
    [{ tokenProperties: { valid: true, action: "organizer_inquiry", hostname: "www.racepace.com.ph" }, riskAnalysis: { score: 0.3 } }, "score"],
  ])("rejects an unacceptable assessment", async (body, reason) => {
    await expect(verifyRecaptchaEnterprise("x".repeat(20), "organizer_inquiry", config, provider(body))).resolves.toEqual({ ok: false, reason });
  });

  it("fails closed when configuration or the provider is unavailable", async () => {
    await expect(verifyRecaptchaEnterprise("x".repeat(20), "organizer_inquiry", null)).resolves.toEqual({ ok: false, reason: "configuration" });
    await expect(verifyRecaptchaEnterprise("x".repeat(20), "organizer_inquiry", config, provider({}, false))).resolves.toEqual({ ok: false, reason: "provider" });
  });
});

it("loads and validates provider configuration", () => {
  const values: Record<string, string> = {
    GOOGLE_CLOUD_PROJECT_ID: "race-pace",
    RECAPTCHA_ENTERPRISE_API_KEY: "api-key",
    RECAPTCHA_ENTERPRISE_SITE_KEY: "site-key",
    RECAPTCHA_ALLOWED_HOSTNAMES: "www.racepace.com.ph, staging.racepace.com.ph",
    RECAPTCHA_MIN_SCORE: "0.8",
  };
  expect(recaptchaConfigFromEnv((key) => values[key])).toEqual({
    projectId: "race-pace",
    apiKey: "api-key",
    siteKey: "site-key",
    allowedHostnames: ["www.racepace.com.ph", "staging.racepace.com.ph"],
    minimumScore: 0.8,
  });
});
