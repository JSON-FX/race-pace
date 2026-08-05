import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ParallaxMedia } from "../ParallaxMedia";

/** Stubs `window.matchMedia` for `(prefers-reduced-motion: reduce)` so the
 *  component's reduced-motion branch is exercised deterministically —
 *  jsdom has no real media-feature evaluation. */
function stubReducedMotion(matches: boolean) {
  const mql = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue(mql),
  );
  return mql;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ParallaxMedia", () => {
  it("renders its children", () => {
    stubReducedMotion(false);
    render(
      <ParallaxMedia>
        <img src="/hero.jpg" alt="Race hero" />
      </ParallaxMedia>,
    );
    expect(screen.getByRole("img", { name: "Race hero" })).toBeInTheDocument();
  });

  it("applies no transform when prefers-reduced-motion is set", () => {
    stubReducedMotion(true);
    render(
      <ParallaxMedia>
        <div>hero content</div>
      </ParallaxMedia>,
    );
    expect(screen.getByText("hero content")).toBeInTheDocument();
    const media = screen.getByTestId("parallax-media");
    expect(media.style.transform).toBe("");
  });

  it("still renders children when matchMedia is unavailable (older browsers)", () => {
    vi.stubGlobal("matchMedia", undefined);
    render(
      <ParallaxMedia>
        <div>hero content</div>
      </ParallaxMedia>,
    );
    expect(screen.getByText("hero content")).toBeInTheDocument();
    expect(screen.getByTestId("parallax-media").style.transform).toBe("");
  });
});
