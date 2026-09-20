const mockOpenAuthSessionAsync = jest.fn();
jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: (...args: unknown[]) => mockOpenAuthSessionAsync(...args),
}));

import { getAuthCaptchaToken, parseCaptchaCallback } from "../lib/captcha";

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_SITE_URL = "https://www.racepace.com.ph/";
});

describe("mobile CAPTCHA bridge", () => {
  it("accepts one token from the fixed app callback", () => {
    expect(parseCaptchaCallback(`racepace://captcha?token=${"x".repeat(20)}`)).toBe("x".repeat(20));
  });

  it.each([
    `https://evil.example/captcha?token=${"x".repeat(20)}`,
    `racepace://wrong?token=${"x".repeat(20)}`,
    "racepace://captcha",
    `racepace://captcha?token=${"x".repeat(20)}&token=${"y".repeat(20)}`,
  ])("rejects an invalid callback: %s", (url) => {
    expect(() => parseCaptchaCallback(url)).toThrow();
  });

  it("opens the hosted challenge and returns its token", async () => {
    mockOpenAuthSessionAsync.mockResolvedValue({ type: "success", url: `racepace://captcha?token=${"t".repeat(20)}` });
    await expect(getAuthCaptchaToken()).resolves.toBe("t".repeat(20));
    expect(mockOpenAuthSessionAsync).toHaveBeenCalledWith(
      "https://www.racepace.com.ph/auth/captcha",
      "racepace://captcha",
    );
  });

  it("fails when the browser challenge is cancelled", async () => {
    mockOpenAuthSessionAsync.mockResolvedValue({ type: "cancel" });
    await expect(getAuthCaptchaToken()).rejects.toThrow("captcha_cancelled");
  });
});
