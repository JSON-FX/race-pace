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
    for (const code of [
      "sold_out", "not_pending", "waiver_required", "invalid_custom_data",
      "invalid_input", "unauthorized", "category_not_found",
      "registration_not_found", "registration_failed", "server_error",
      "registration_closed", "already_registered",
    ]) {
      expect(checkoutErrorMessage(code)).not.toBe("");
      expect(checkoutErrorMessage(code)).not.toContain("_");
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

  it("falls back to readable copy for an unknown code", () => {
    expect(checkoutErrorMessage("something_new")).toBe("Something went wrong. Please try again.");
  });
});
