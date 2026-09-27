import { describe, expect, it } from "vitest";
import { filterGuides, guideDuration, guideFileError, guideInputSchema, GUIDE_MAX_BYTES, type GuideVideo } from "./guides";

const id = "11111111-1111-4111-8111-111111111111";
const upload = "22222222-2222-4222-8222-222222222222";
const input = {
  id, title: "Create an event", description: "Prepare categories and capacity.", topic: "Events",
  duration_seconds: 60, storage_path: `${id}/${upload}.mp4`, thumbnail_path: `${id}/${upload}.jpg`, is_published: true,
};

describe("guide metadata", () => {
  it("accepts immutable video and optional thumbnail paths and trims text", () => {
    const parsed = guideInputSchema.parse({ ...input, title: "  Create an event  ", description: "  Prepare categories.  " });
    expect(parsed.title).toBe("Create an event");
    expect(parsed.description).toBe("Prepare categories.");
    expect(guideInputSchema.safeParse({ ...input, storage_path: `${id}/${upload}.webm`, thumbnail_path: null }).success).toBe(true);
  });

  it.each([
    { title: "  " }, { title: "x".repeat(161) }, { description: "  " }, { description: "x".repeat(2001) },
    { topic: "Unknown" }, { duration_seconds: 0 }, { duration_seconds: 14401 }, { duration_seconds: 1.5 },
    { is_published: "true" }, { id: "not-a-uuid" },
  ])("rejects invalid metadata %j", change => {
    expect(guideInputSchema.safeParse({ ...input, ...change }).success).toBe(false);
  });

  it("accepts exact title, description, and duration limits", () => {
    expect(guideInputSchema.safeParse({ ...input, title: "x".repeat(160), description: "x".repeat(2000), duration_seconds: 14400 }).success).toBe(true);
    expect(guideInputSchema.safeParse({ ...input, duration_seconds: 1 }).success).toBe(true);
  });

  it.each([
    { storage_path: `${upload}/${id}.mp4` }, { thumbnail_path: `${upload}/${id}.jpg` },
    { storage_path: `${id}/../${upload}.mp4` }, { storage_path: `${id}/${upload}xmp4` },
    { storage_path: `${id}/${upload}.mov` }, { thumbnail_path: `${id}/${upload}.png` },
    { storage_path: `https://storage.example/${id}/${upload}.mp4` },
  ])("rejects foreign or malformed object paths %j", change => {
    expect(guideInputSchema.safeParse({ ...input, ...change }).success).toBe(false);
  });
});

describe("guide files", () => {
  it.each(["video/mp4", "video/webm"])("accepts %s at the 50 MiB limit", type => {
    expect(guideFileError({ type, size: GUIDE_MAX_BYTES })).toBeNull();
  });
  it("rejects unsupported, empty, and oversized files with useful recovery", () => {
    expect(guideFileError({ type: "image/jpeg", size: 20 })).toMatch(/MP4 or WebM/);
    expect(guideFileError({ type: "video/mp4", size: 0 })).toMatch(/empty.*another video/);
    expect(guideFileError({ type: "video/mp4", size: GUIDE_MAX_BYTES + 1 })).toMatch(/50 MiB.*smaller file/);
  });
});

describe("guide discovery", () => {
  const guides: GuideVideo[] = [
    { ...input, topic: "Events", title: "Zulu event", description: "Allocate capacity", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", duration_seconds: 120 },
    { ...input, id: upload, topic: "Payments", title: "Alpha payments", description: "Read pending records", created_at: "2026-09-03T00:00:00Z", updated_at: "2026-09-03T00:00:00Z", duration_seconds: 30 },
    { ...input, id: "33333333-3333-4333-8333-333333333333", topic: "Events", title: "Bravo publishing", description: "Review registration", created_at: "2026-09-02T00:00:00Z", updated_at: "2026-09-02T00:00:00Z", duration_seconds: 75 },
  ];
  it("matches title, description, and topic without case or surrounding whitespace", () => {
    expect(filterGuides(guides, "  ALPHA  ", "All guides", "recommended").map(g => g.title)).toEqual(["Alpha payments"]);
    expect(filterGuides(guides, "capacity", "All guides", "recommended").map(g => g.title)).toEqual(["Zulu event"]);
    expect(filterGuides(guides, "payments", "All guides", "recommended").map(g => g.title)).toEqual(["Alpha payments"]);
    expect(filterGuides(guides, "pending", "Events", "recommended")).toEqual([]);
  });
  it("combines topics and sorts while preserving original input order", () => {
    expect(filterGuides(guides, "", "Events", "az").map(g => g.title)).toEqual(["Bravo publishing", "Zulu event"]);
    expect(filterGuides(guides, "", "All guides", "shortest").map(g => g.duration_seconds)).toEqual([30, 75, 120]);
    expect(filterGuides(guides, "", "All guides", "recommended").map(g => g.title)).toEqual(["Alpha payments", "Bravo publishing", "Zulu event"]);
    expect(guides.map(g => g.title)).toEqual(["Zulu event", "Alpha payments", "Bravo publishing"]);
  });
  it("formats native durations without losing seconds or the four-hour limit", () => {
    expect(guideDuration(1)).toBe("0:01");
    expect(guideDuration(523)).toBe("8:43");
    expect(guideDuration(14400)).toBe("240:00");
  });
});
