import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import LandingPage from "../page";
import RunnerHome from "../home/page";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/events", () => ({
  fetchMarketplaceEvents: vi.fn().mockResolvedValue([]),
  fetchCategories: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/components/SiteHeader", () => ({ SiteHeader: () => <header>Site header</header> }));
vi.mock("@/components/landing/CourseAtlas", () => ({
  CourseAtlas: () => <main>Course Atlas landing</main>,
}));

it("uses the root route for the Course Atlas landing page", () => {
  render(<LandingPage />);

  expect(screen.getByText("Course Atlas landing")).toBeInTheDocument();
});

it("keeps the event-browsing home available at /home", async () => {
  render(await RunnerHome());

  expect(screen.getByRole("heading", { name: "No races are open for entry right now." })).toBeInTheDocument();
});
