import { describe, expect, it } from "vitest";
import { formatPhilippinePhone } from "../phone";

describe("formatPhilippinePhone", () => {
  it.each([
    ["09175550142", "+63 917 555 0142"],
    ["9175550142", "+63 917 555 0142"],
    ["+63 917-555-0142", "+63 917 555 0142"],
    ["0917", "+63 917"],
    ["", ""],
  ])("formats %s", (input, expected) => {
    expect(formatPhilippinePhone(input)).toBe(expected);
  });

  it("limits input to one Philippine national number", () => {
    expect(formatPhilippinePhone("09175550142123")).toBe("+63 917 555 0142");
  });
});
