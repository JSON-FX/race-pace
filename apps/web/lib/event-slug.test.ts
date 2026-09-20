import { describe, expect, it } from "vitest";
import { eventPublicPath, eventPublicUrl, isValidEventSlug, normalizeEventSlug } from "./event-slug";

describe("event slug", () => {
  it("normalizes names to lowercase ASCII kebab-case", () => {
    expect(normalizeEventSlug("  Yalabyalam Backyard Ultra  ")).toBe("yalabyalam-backyard-ultra");
    expect(normalizeEventSlug("Peñafrancia Trail & Ultra")).toBe("penafrancia-trail-ultra");
  });

  it("truncates generated slugs without leaving a trailing separator", () => {
    const slug = normalizeEventSlug(`${"a".repeat(78)} long title`);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("accepts only the database slug shape", () => {
    expect(isValidEventSlug("apo-sky-ultra-2027")).toBe(true);
    expect(isValidEventSlug("Bad Slug")).toBe(false);
    expect(isValidEventSlug("a".repeat(81))).toBe(false);
  });

  it("prefers a slug path and builds environment-specific full URLs", () => {
    expect(eventPublicPath({ id: "uuid", slug: "apo-sky-ultra" })).toBe("/events/apo-sky-ultra");
    expect(eventPublicPath({ id: "uuid", slug: null })).toBe("/events/uuid");
    expect(eventPublicUrl("apo-sky-ultra", "https://staging.racepace.com.ph/"))
      .toBe("https://staging.racepace.com.ph/events/apo-sky-ultra");
  });
});
