import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RaceKitCard } from "../RaceKitCard";

const PAST = "2020-01-01T00:00:00Z";
const FUTURE = "2099-01-01T00:00:00Z";

describe("RaceKitCard", () => {
  it("shows the current size and a change affordance before the cutoff", () => {
    render(<RaceKitCard shirtSize="L" kitEditClosesAt={FUTURE} onChange={vi.fn()} />);
    expect(screen.getByText("L")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /change/i })).toBeInTheDocument();
  });

  it("locks after the cutoff and offers no change button", () => {
    render(<RaceKitCard shirtSize="L" kitEditClosesAt={PAST} onChange={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /change/i })).not.toBeInTheDocument();
    expect(screen.getByText(/locked/i)).toBeInTheDocument();
  });

  it("signals the locked state with text, not colour alone", () => {
    render(<RaceKitCard shirtSize="L" kitEditClosesAt={PAST} onChange={vi.fn()} />);
    expect(screen.getByText(/contact the organiser|contact the organizer/i)).toBeInTheDocument();
  });

  it("stays editable when the event has no kit deadline", () => {
    render(<RaceKitCard shirtSize="M" kitEditClosesAt={null} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /change/i })).toBeInTheDocument();
  });

  it("renders a placeholder when no size was ever chosen", () => {
    render(<RaceKitCard shirtSize={null} kitEditClosesAt={FUTURE} onChange={vi.fn()} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  // The "locked" text alone could pass even if the lock icon were dropped, which is
  // exactly the colour/icon redundancy this card exists to guarantee — assert the
  // icon independently of the word so both halves of that guarantee are checked.
  it("pairs the locked text with an icon, not text alone", () => {
    const { container } = render(<RaceKitCard shirtSize="L" kitEditClosesAt={PAST} onChange={vi.fn()} />);
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
  });
});
