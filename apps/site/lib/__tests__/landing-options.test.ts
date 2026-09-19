import { describe, expect, it } from "vitest";
import { COURSE_ATLAS_MEDIA, LANDING_OPTIONS, landingOption } from "../landing-options";

describe("landing page options", () => {
  it("offers exactly five distinct concepts", () => {
    expect(LANDING_OPTIONS).toHaveLength(5);
    expect(new Set(LANDING_OPTIONS.map((option) => option.slug)).size).toBe(5);
    expect(new Set(LANDING_OPTIONS.map((option) => option.name)).size).toBe(5);
  });

  it("keeps the concepts in their numbered review order", () => {
    expect(LANDING_OPTIONS.map((option) => option.number)).toEqual(["01", "02", "03", "04", "05"]);
  });

  it("resolves a known concept and rejects an unknown route", () => {
    expect(landingOption("course-atlas")?.name).toBe("Course Atlas");
    expect(landingOption("not-a-concept")).toBeUndefined();
  });

  it("gives every Course Atlas section its own road-and-trail image", () => {
    const scenes = Object.values(COURSE_ATLAS_MEDIA);

    expect(scenes).toHaveLength(4);
    expect(new Set(scenes.map((scene) => scene.src)).size).toBe(4);
    expect(scenes.every((scene) => scene.src.endsWith(".webp"))).toBe(true);
    expect(scenes.every((scene) => scene.audiences.includes("road") && scene.audiences.includes("trail"))).toBe(true);
  });
});
