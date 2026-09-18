import { describe, expect, it } from "vitest";
import { assertGroupSelection, GroupCheckoutError } from "../groupCheckout";

describe("group checkout selection", () => {
  const first = "00000000-0000-4000-8000-000000000001";
  const second = "00000000-0000-4000-8000-000000000002";
  it("accepts separate participants when visible capacity permits", () => {
    expect(() => assertGroupSelection([first, second], 2)).not.toThrow();
  });
  it("rejects a repeated Passport before any reservation call", () => {
    expect(() => assertGroupSelection([first, first], 2)).toThrowError(new GroupCheckoutError("duplicate_participants"));
  });
  it("rejects a group larger than visible capacity", () => {
    expect(() => assertGroupSelection([first, second], 1)).toThrowError(new GroupCheckoutError("insufficient_visible_slots"));
  });
  it("requires at least one and at most ten participants", () => {
    expect(() => assertGroupSelection([], 10)).toThrow();
    expect(() => assertGroupSelection(Array.from({ length: 11 }, (_, i) => `participant-${i}`), 20)).toThrow();
  });
});
