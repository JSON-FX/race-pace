export const LANDING_OPTIONS = [
  {
    slug: "ridge-signal",
    number: "01",
    name: "Ridge Signal",
    direction: "Immersive · cinematic · focused",
    summary: "A spacious mountain-led hero that makes Race Pace feel like the doorway to the next adventure.",
  },
  {
    slug: "course-atlas",
    number: "02",
    name: "Course Atlas",
    direction: "Cartographic · precise · product-led",
    summary: "A route-map inspired system that explains discovery, registration, and race day with confident clarity.",
  },
  {
    slug: "start-line",
    number: "03",
    name: "Start Line",
    direction: "Bold · athletic · editorial",
    summary: "A high-energy poster composition built around the feeling just before the gun goes off.",
  },
  {
    slug: "trail-journal",
    number: "04",
    name: "Trail Journal",
    direction: "Human · tactile · story-driven",
    summary: "An outdoor field journal that treats every race as a place, a story, and a memory worth keeping.",
  },
  {
    slug: "pace-together",
    number: "05",
    name: "Pace Together",
    direction: "Warm · communal · optimistic",
    summary: "A people-first direction that positions Race Pace as the shared home for runners across the Philippines.",
  },
] as const;

export type LandingOption = (typeof LANDING_OPTIONS)[number];
export type LandingOptionSlug = LandingOption["slug"];

export const COURSE_ATLAS_MEDIA = {
  hero: {
    src: "/landing/course-atlas/route-choice.webp",
    audiences: ["road", "trail"],
  },
  journey: {
    src: "/landing/course-atlas/course-discovery.webp",
    audiences: ["road", "trail"],
  },
  preparation: {
    src: "/landing/course-atlas/race-preparation.webp",
    audiences: ["road", "trail"],
  },
  finish: {
    src: "/landing/course-atlas/shared-finish.webp",
    audiences: ["road", "trail"],
  },
} as const;

export function landingOption(slug: string): LandingOption | undefined {
  return LANDING_OPTIONS.find((option) => option.slug === slug);
}
