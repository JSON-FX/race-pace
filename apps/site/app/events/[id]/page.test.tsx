import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { EventRow } from "@/lib/events";

const { fetchEvent, fetchCategories, fetchAddons, fetchMyEntry, permanentRedirect } = vi.hoisted(() => ({
  fetchEvent: vi.fn(),
  fetchCategories: vi.fn(),
  fetchAddons: vi.fn(),
  fetchMyEntry: vi.fn(),
  permanentRedirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  permanentRedirect,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock("@/lib/events", async () => {
  const actual = await vi.importActual<typeof import("@/lib/events")>("@/lib/events");
  return { ...actual, fetchEvent, fetchCategories, fetchAddons };
});
vi.mock("@/lib/entry", () => ({ fetchMyEntry }));
vi.mock("@/components/SiteHeader", () => ({ SiteHeader: () => <div>Header</div> }));
vi.mock("@/components/event/EventPageBody", () => ({
  EventPageBody: ({ event }: { event: EventRow }) => <div>{event.name}</div>,
}));

import EventPage, { generateMetadata } from "./page";

const event = {
  id: "3f29e7df-fe90-44a6-bfa4-219ffeaad816",
  slug: "yalabyalam-backyard-ultra",
  name: "Yalabyalam Backyard Ultra",
  event_date: "2026-11-28",
  end_date: "2026-11-29",
  city_name: "City of Malaybalay",
  distances: [6.71],
  status: "open",
  registration_closes_at: null,
  waiver_version_id: null,
} as EventRow;

beforeEach(() => {
  fetchEvent.mockReset().mockResolvedValue(event);
  fetchCategories.mockReset().mockResolvedValue([]);
  fetchAddons.mockReset().mockResolvedValue([]);
  fetchMyEntry.mockReset().mockResolvedValue(null);
  permanentRedirect.mockClear();
});

it("renders a slug request and loads child rows through the resolved UUID", async () => {
  const ui = await EventPage({
    params: Promise.resolve({ id: event.slug! }),
    searchParams: Promise.resolve({}),
  });
  render(ui);
  expect(screen.getByText(event.name)).toBeInTheDocument();
  expect(fetchCategories).toHaveBeenCalledWith(expect.anything(), event.id);
  expect(fetchAddons).toHaveBeenCalledWith(expect.anything(), event.id);
  expect(fetchMyEntry).toHaveBeenCalledWith(expect.anything(), event.id, null);
});

it("permanently redirects an existing UUID link to the slug and preserves its query", async () => {
  await expect(EventPage({
    params: Promise.resolve({ id: event.id }),
    searchParams: Promise.resolve({ registered: "r1", source: ["email", "share"] }),
  })).rejects.toThrow("REDIRECT:/events/yalabyalam-backyard-ultra?registered=r1&source=email&source=share");
});

it("publishes the slug URL as canonical metadata", async () => {
  const old = process.env.NEXT_PUBLIC_SITE_URL;
  process.env.NEXT_PUBLIC_SITE_URL = "https://www.racepace.com.ph";
  try {
    const metadata = await generateMetadata({ params: Promise.resolve({ id: event.slug! }) });
    expect(metadata.alternates).toEqual({ canonical: "https://www.racepace.com.ph/events/yalabyalam-backyard-ultra" });
    expect(metadata.openGraph).toMatchObject({ url: "https://www.racepace.com.ph/events/yalabyalam-backyard-ultra" });
  } finally {
    process.env.NEXT_PUBLIC_SITE_URL = old;
  }
});
