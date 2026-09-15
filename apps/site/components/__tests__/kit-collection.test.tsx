import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RaceKitCard } from "../RaceKitCard";
const mocks = vi.hoisted(() => ({ single: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ is: () => ({ maybeSingle: mocks.single }) }),
      }),
    }),
  }),
}));
beforeEach(() => vi.resetAllMocks());
it("shows collection and prevents shirt changes", async () => {
  mocks.single.mockResolvedValue({
    data: { released_at: "2026-09-16T00:00:00Z", kit: { shirt_size: "M" } },
  });
  render(
    <RaceKitCard
      registrationId="r"
      shirtSize="L"
      kitEditClosesAt={null}
      onChange={vi.fn()}
    />,
  );
  expect(
    await screen.findByText(/Your kit has been collected/),
  ).toBeInTheDocument();
  expect(screen.getByText("M")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Change" }),
  ).not.toBeInTheDocument();
});
it("fails closed when collection status cannot be loaded", async () => {
  mocks.single.mockResolvedValue({ data: null, error: { message: "offline" } });
  render(
    <RaceKitCard
      registrationId="r"
      shirtSize="M"
      kitEditClosesAt={null}
      onChange={vi.fn()}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Collection status unavailable",
  );
  expect(
    screen.queryByRole("button", { name: "Change" }),
  ).not.toBeInTheDocument();
});
