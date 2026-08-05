import { describe, it, expect } from "vitest";
import { isRegistrationClosed } from "../eventStatus";

describe("isRegistrationClosed", () => {
  it("keeps almost_full open — it is still registerable, just tight on slots", () => {
    expect(isRegistrationClosed("almost_full")).toBe(false);
  });

  it("keeps open registerable", () => {
    expect(isRegistrationClosed("open")).toBe(false);
  });

  it.each(["cancelled", "closed", "completed"])("closes registration for %s", (status) => {
    expect(isRegistrationClosed(status)).toBe(true);
  });

  it("does not close registration for draft (draft events aren't visible via RLS anyway)", () => {
    expect(isRegistrationClosed("draft")).toBe(false);
  });
});
