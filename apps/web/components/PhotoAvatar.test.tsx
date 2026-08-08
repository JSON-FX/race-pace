import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PhotoAvatar } from "./PhotoAvatar";

const URL_ = "https://cdn.test/u1/avatar-1.png";

describe("PhotoAvatar", () => {
  it("shows the monogram when the runner has no photo", () => {
    render(<PhotoAvatar url={null} fallback="MS" />);
    expect(screen.getByText("MS")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows the photo when there is one", () => {
    const { container } = render(<PhotoAvatar url={URL_} fallback="MS" />);
    expect(container.querySelector("img")).toHaveAttribute("src", URL_);
    expect(screen.queryByText("MS")).not.toBeInTheDocument();
  });

  // The runner site stores framing on the fragment; the admin has to strip it
  // off the src and apply it as geometry, not hand the whole string to the
  // browser and hope.
  it("applies the runner's saved framing rather than a blind centre crop", () => {
    const { container } = render(<PhotoAvatar url={`${URL_}#c=25,25,25,25`} fallback="MS" />);
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("src", URL_);
    expect(img).toHaveStyle({ width: "400%", left: "-100%" });
  });

  it("renders a photo set on mobile, which carries no framing", () => {
    const { container } = render(<PhotoAvatar url={URL_} fallback="MS" />);
    expect(container.querySelector("img")).toHaveStyle({ objectFit: "cover" });
  });

  // A profile row can outlive its storage object. Falling back beats leaving a
  // broken-image glyph in the middle of a table.
  it("falls back to the monogram when the image fails to load", () => {
    const { container } = render(<PhotoAvatar url={URL_} fallback="MS" />);
    fireEvent.error(container.querySelector("img")!);
    expect(screen.getByText("MS")).toBeInTheDocument();
  });
});
