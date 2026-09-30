import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { signOut } from "@/lib/auth";
import { SiteNav } from "../SiteNav";
import { RunnerTabBar } from "../RunnerTabBar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/home",
}));

vi.mock("motion/react", async () => {
  const React = await import("react");

  return {
    motion: {
      span: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
        React.createElement("span", { className }, children),
    },
    useReducedMotion: () => true,
  };
});

vi.mock("@/lib/auth", () => ({ signOut: vi.fn() }));

it("keeps the brand on the landing page while Home opens the race-browsing route", () => {
  render(<SiteNav signedIn={false} />);

  expect(screen.getByRole("link", { name: "Race Pace home" })).toHaveAttribute("href", "/");
  expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/home");
  expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Organizers" })).toHaveAttribute("href", "/organizers");
});

it("uses /home for the signed-in runner tab", () => {
  render(<RunnerTabBar signedIn />);

  expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/home");
  expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Organizers" })).toHaveAttribute("href", "/organizers");
});

it("keeps log out available in the signed-in header on phones", () => {
  vi.mocked(signOut).mockImplementation(() => new Promise(() => {}));
  render(<SiteNav signedIn />);
  const logout = screen.getByRole("button", { name: "Log out" });
  fireEvent.click(logout);
  expect(signOut).toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Logging out…" })).toBeDisabled();
});
