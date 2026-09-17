import { describe, expect, it } from "vitest";
import { isPublicLaunchClosed, isStagingEnvironment } from "./launchGate";

describe("temporary public launch gate", () => {
  it("closes production even when Vercel system variables are unavailable", () => {
    expect(isPublicLaunchClosed(undefined, "www.racepace.com.ph")).toBe(true);
    expect(isPublicLaunchClosed("production", "race-pace-site-123.vercel.app")).toBe(true);
  });

  it("does not close the isolated staging or local applications", () => {
    expect(isPublicLaunchClosed("staging", "staging.racepace.com.ph")).toBe(false);
    expect(isPublicLaunchClosed(undefined, "racepace.lan")).toBe(false);
    expect(isStagingEnvironment("staging", "some-preview.vercel.app")).toBe(true);
    expect(isStagingEnvironment(undefined, "staging-admin.racepace.com.ph")).toBe(true);
  });
});
