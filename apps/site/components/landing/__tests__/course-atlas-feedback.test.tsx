import type { ElementType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { CourseAtlas } from "../CourseAtlas";

vi.mock("@/components/event/motion-primitives", async () => {
  const React = await import("react");

  return {
    Reveal: ({
      as: Tag = "div",
      children,
      className,
    }: {
      as?: ElementType;
      children: ReactNode;
      className?: string;
    }) => React.createElement(Tag, { className }, children),
  };
});

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((media: string) => ({
      matches: false,
      media,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

afterEach(() => {
  cleanup();
});

describe("Course Atlas browser feedback", () => {
  it("keeps every generated background free of decorative grids and contour SVGs", () => {
    render(<CourseAtlas />);

    for (const scene of ["hero", "journey", "preparation", "finish"]) {
      const media = screen.getByTestId(`course-atlas-media-${scene}`);
      expect(media.querySelector("svg")).toBeNull();
      expect(media.childElementCount).toBe(2);
    }
  });

  it("uses the requested journey heading color without the copy arrow", () => {
    render(<CourseAtlas />);

    expect(screen.getByRole("heading", { name: "A clear course from curious to confirmed." })).toHaveClass(
      "text-forest",
    );

    const copy = screen.getByText(/Like a good route marker/);
    expect(copy.parentElement?.querySelector("svg")).toBeNull();
  });

  it("keeps breathing room between the checkpoint heading and map icon", () => {
    render(<CourseAtlas />);

    const title = screen.getByText("Ready in three checkpoints");
    expect(title.parentElement?.parentElement).toHaveClass("gap-5", "sm:gap-6");
  });

  it("ends with a shared runner and organizer inquiry section", () => {
    render(<CourseAtlas />);

    expect(screen.getByRole("heading", { name: "Let's clear the way forward." })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Send an inquiry" })).toHaveAttribute("href", "/inquiry");
    expect(screen.getAllByRole("link", { name: "List your race" }).every((link) => link.getAttribute("href") === "/#organizers")).toBe(true);

    const section = document.querySelector("#organizers");
    expect(section).toHaveAttribute("data-seamless-footer");
    expect(section).not.toHaveClass("pt-20", "sm:pt-28");
  });

  it("does not show the removed Course Atlas eyebrow", () => {
    render(<CourseAtlas />);
    expect(screen.queryByText(/Course Atlas.*Road to ridge/i)).not.toBeInTheDocument();
  });
});
