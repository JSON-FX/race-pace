import { describe, it, expect } from "vitest";
import { isRegistrationClosed } from "./eventStatus";

describe("isRegistrationClosed", () => {
  it("closes registration for terminal/blocked statuses", () => {
    expect(isRegistrationClosed("cancelled", null)).toBe(true);
    expect(isRegistrationClosed("closed", null)).toBe(true);
    expect(isRegistrationClosed("completed", null)).toBe(true);
  });

  it("keeps registration open for everything else, including almost_full", () => {
    expect(isRegistrationClosed("published", null)).toBe(false);
    expect(isRegistrationClosed("almost_full", null)).toBe(false);
    expect(isRegistrationClosed("draft", null)).toBe(false);
  });

  it("opens registration when status is open and deadline is null", () => {
    expect(isRegistrationClosed("published", null)).toBe(false);
  });

  it("opens registration when status is open and deadline is in the future", () => {
    expect(isRegistrationClosed("published", "2099-01-01T00:00:00Z")).toBe(
      false,
    );
  });

  it("closes registration when status is open but deadline is in the past", () => {
    expect(isRegistrationClosed("published", "2020-01-01T00:00:00Z")).toBe(true);
  });

  it("closes registration for terminal status regardless of future deadline", () => {
    expect(isRegistrationClosed("cancelled", "2099-01-01T00:00:00Z")).toBe(true);
  });
});
