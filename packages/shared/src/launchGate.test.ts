import { describe, expect, it } from "vitest";
import { isStagingEnvironment } from "./launchGate";

describe("staging environment detection", () => {
  it("recognizes staging without classifying production or local hosts", () => {
    expect(isStagingEnvironment("staging", "some-preview.vercel.app")).toBe(true);
    expect(isStagingEnvironment(undefined, "staging-admin.racepace.com.ph")).toBe(true);
    expect(isStagingEnvironment("production", "www.racepace.com.ph")).toBe(false);
    expect(isStagingEnvironment(undefined, "racepace.lan")).toBe(false);
  });
});
