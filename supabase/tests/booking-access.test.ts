import { describe, expect, it } from "vitest";
import { canAccessBooking } from "../functions/_shared/bookingAccess";
describe("booking payment access", () => {
  it("allows the booking helper for an unclaimed participant", () => {
    expect(canAccessBooking("helper", { user_id: null, booked_by_user_id: "helper" })).toBe(true);
  });
  it("allows the participant to access their own entry", () => {
    expect(canAccessBooking("runner", { user_id: "runner", booked_by_user_id: "helper" })).toBe(true);
  });
  it("keeps legacy self bookings accessible", () => {
    expect(canAccessBooking("runner", { user_id: "runner" })).toBe(true);
  });
  it("refuses unrelated users, missing actors and missing bookings", () => {
    const booking = { user_id: "runner", booked_by_user_id: "helper" };
    expect(canAccessBooking("stranger", booking)).toBe(false);
    expect(canAccessBooking(null, { user_id: null, booked_by_user_id: null })).toBe(false);
    expect(canAccessBooking(undefined, booking)).toBe(false);
    expect(canAccessBooking("runner", null)).toBe(false);
  });
});
