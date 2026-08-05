import { describe, it, expect } from "vitest";
import { isRegistrationClosed } from "./eventStatus";

describe("isRegistrationClosed", () => {
  it("closes registration for terminal/blocked statuses", () => {
    expect(isRegistrationClosed("cancelled")).toBe(true);
    expect(isRegistrationClosed("closed")).toBe(true);
    expect(isRegistrationClosed("completed")).toBe(true);
  });

  it("keeps registration open for everything else, including almost_full", () => {
    expect(isRegistrationClosed("published")).toBe(false);
    expect(isRegistrationClosed("almost_full")).toBe(false);
    expect(isRegistrationClosed("draft")).toBe(false);
  });
});
