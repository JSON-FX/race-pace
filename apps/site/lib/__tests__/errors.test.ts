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
    ]) {
      expect(checkoutErrorMessage(code)).not.toBe("");
      expect(checkoutErrorMessage(code)).not.toContain("_");
    }
  });

  it("falls back to readable copy for an unknown code", () => {
    expect(checkoutErrorMessage("something_new")).toBe("Something went wrong. Please try again.");
  });
});
