import { describe, it, expect } from "vitest";
import { isRegistrationClosed } from "../eventStatus";

const PAST = "2020-01-01T00:00:00Z";
const FUTURE = "2099-01-01T00:00:00Z";

describe("isRegistrationClosed", () => {
  it("keeps almost_full open — it is still registerable, just tight on slots", () => {
    expect(isRegistrationClosed("almost_full", null)).toBe(false);
  });

  it("keeps open registerable", () => {
    expect(isRegistrationClosed("open", null)).toBe(false);
  });

  it.each(["cancelled", "closed", "completed"])("closes registration for %s", (status) => {
    expect(isRegistrationClosed(status, null)).toBe(true);
  });

  it("does not close registration for draft (draft events aren't visible via RLS anyway)", () => {
    expect(isRegistrationClosed("draft", null)).toBe(false);
  });

  it("stays open when the deadline is still ahead", () => {
    expect(isRegistrationClosed("open", FUTURE)).toBe(false);
  });

  it("closes once the deadline has passed", () => {
    expect(isRegistrationClosed("open", PAST)).toBe(true);
  });

  it("treats a null deadline as no deadline", () => {
    expect(isRegistrationClosed("open", null)).toBe(false);
  });

  it("lets a closed status win even with a deadline in the future", () => {
    expect(isRegistrationClosed("cancelled", FUTURE)).toBe(true);
  });
});
