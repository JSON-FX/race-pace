import { describe, it, expect } from "vitest";
import { checkoutErrorMessage } from "../errors";

describe("checkoutErrorMessage", () => {
  it("explains a sold-out distance", () => {
    expect(checkoutErrorMessage("sold_out")).toBe("This distance just sold out. Try another distance for this race.");
  });

  it("points an already-paid runner at their ticket", () => {
    expect(checkoutErrorMessage("not_pending")).toBe("You've already paid for this registration. Check My Races for your ticket.");
  });

  it("covers every error code the edge functions return", () => {
    // The two original assertions could not tell a MAPPED code from an
    // unmapped one: the "Something went wrong" fallback is neither empty nor
    // underscored, so this list stayed green for a year with `org_suspended`
    // missing from MESSAGES entirely. Asserting the answer is not the
    // fallback is what makes the title above true.
    const FALLBACK = checkoutErrorMessage("__definitely_not_a_real_code__");
    for (const code of [
      "sold_out", "not_pending", "waiver_required", "invalid_custom_data",
      "invalid_input", "unauthorized", "category_not_found",
      "registration_not_found", "registration_failed", "server_error",
      "registration_closed", "already_registered", "org_suspended",
    ]) {
      expect(checkoutErrorMessage(code)).not.toBe("");
      expect(checkoutErrorMessage(code)).not.toContain("_");
      expect(checkoutErrorMessage(code), `${code} has no entry in MESSAGES`).not.toBe(FALLBACK);
    }
  });

  it("explains a cancelled/closed event can't be registered for", () => {
    expect(checkoutErrorMessage("registration_closed")).toBe("Registration for this race is no longer open.");
  });

  it("points a duplicate registration at My Races as the fallback (RegisterWizard prefers routing to /pay/<id> when it has one)", () => {
    expect(checkoutErrorMessage("already_registered")).toBe(
      "You're already entered in this race. Check My Races for your entry.",
    );
  });

  it("tells a runner an org is closed rather than inviting a retry", () => {
    // registrations-checkout:58 and payment-session both answer 409
    // { error: "org_suspended" }. With no entry here `checkoutErrorMessage`
    // fell through to "Something went wrong. Please try again." — retry copy
    // for a condition no amount of retrying clears.
    const msg = checkoutErrorMessage("org_suspended");
    expect(msg).toBe(
      "This organizer isn't taking registrations right now. Nothing was charged — try again another time or pick another race.",
    );
    expect(msg).not.toMatch(/try again\.$/i);
  });

  it("falls back to readable copy for an unknown code", () => {
    expect(checkoutErrorMessage("something_new")).toBe("Something went wrong. Please try again.");
  });
});
