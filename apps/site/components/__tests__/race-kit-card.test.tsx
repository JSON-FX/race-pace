import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RaceKitCard } from "../RaceKitCard";
import { ShirtSizeSheet } from "../ShirtSizeSheet";
import * as kit from "@/lib/kit";

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

  // Regression coverage for the countdown badge itself — a prior review found nothing
  // asserted its presence, its count, or the day/days split, so a mutation that always
  // rendered null (or always said "days") passed the whole suite.
  it("shows the days-left badge with the correct count for a future cutoff", () => {
    // 5 days minus a minute of buffer: comfortably inside (4d, 5d] so Math.ceil is 5
    // regardless of the few milliseconds the test takes to run.
    const cutoff = new Date(Date.now() + 5 * 86_400_000 - 60_000).toISOString();
    render(<RaceKitCard shirtSize="L" kitEditClosesAt={cutoff} onChange={vi.fn()} />);
    expect(screen.getByText("5 days left")).toBeInTheDocument();
  });

  it("uses the singular 'day' when exactly one day remains", () => {
    // A few hours out lands safely inside (0, 1d], giving Math.ceil(0.x) === 1 without
    // racing a 24-hour boundary.
    const cutoff = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    render(<RaceKitCard shirtSize="L" kitEditClosesAt={cutoff} onChange={vi.fn()} />);
    expect(screen.getByText("1 day left")).toBeInTheDocument();
  });

  it("renders no countdown badge when the event has no kit deadline", () => {
    render(<RaceKitCard shirtSize="M" kitEditClosesAt={null} onChange={vi.fn()} />);
    expect(screen.queryByText(/day.*left/i)).not.toBeInTheDocument();
  });
});

describe("ShirtSizeSheet", () => {
  it("offers every canonical size and marks the current one pressed", () => {
    render(<ShirtSizeSheet registrationId="r1" current="L" onClose={vi.fn()} onSaved={vi.fn()} />);
    expect(screen.getByRole("button", { name: "XS" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "L" })).toHaveAttribute("aria-pressed", "true");
  });

  it("saves the picked size and reports success upward", async () => {
    const spy = vi.spyOn(kit, "updateShirtSize").mockResolvedValue("ok");
    const onSaved = vi.fn();
    render(<ShirtSizeSheet registrationId="r1" current="M" onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "XL" }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith("r1", "XL"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("surfaces the deadline message instead of closing when the RPC says locked", async () => {
    vi.spyOn(kit, "updateShirtSize").mockResolvedValue("locked");
    const onSaved = vi.fn();
    render(<ShirtSizeSheet registrationId="r1" current="M" onClose={vi.fn()} onSaved={onSaved} />);
    fireEvent.click(screen.getByRole("button", { name: "S" }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(await screen.findByText(/organiser|organizer/i)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
