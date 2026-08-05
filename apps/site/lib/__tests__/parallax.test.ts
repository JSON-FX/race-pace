import { describe, it, expect } from "vitest";
import { parallaxOffset, DEFAULT_PARALLAX_MAX_OFFSET } from "../parallax";

describe("parallaxOffset", () => {
  it("is zero before the section has scrolled into play", () => {
    expect(parallaxOffset(0, 500)).toBe(0);
    expect(parallaxOffset(300, 500)).toBe(0);
  });

  it("is zero at the exact moment the section's top reaches the viewport top", () => {
    expect(parallaxOffset(500, 500)).toBe(0);
  });

  it("grows proportionally to scroll distance past the section, scaled by factor", () => {
    expect(parallaxOffset(600, 500, { factor: 0.3, maxOffset: 1000 })).toBeCloseTo(30);
    expect(parallaxOffset(700, 500, { factor: 0.3, maxOffset: 1000 })).toBeCloseTo(60);
  });

  it("clamps at maxOffset no matter how far the page scrolls", () => {
    expect(parallaxOffset(100_000, 0, { factor: 0.3, maxOffset: 60 })).toBe(60);
    expect(parallaxOffset(1_000_000, 0)).toBe(DEFAULT_PARALLAX_MAX_OFFSET);
  });

  it("never goes negative even if scrollY is behind sectionTop by a lot", () => {
    expect(parallaxOffset(-5000, 500)).toBe(0);
  });

  it("returns a constant zero under reduced motion regardless of scroll position", () => {
    expect(parallaxOffset(0, 0, { reducedMotion: true })).toBe(0);
    expect(parallaxOffset(50_000, 100, { reducedMotion: true, factor: 0.9, maxOffset: 500 })).toBe(0);
  });
});
