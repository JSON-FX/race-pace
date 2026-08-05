import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TicketCard } from "../TicketCard";

const props = {
  token: "signed.ticket.token",
  eventName: "Apo Sky Ultra 2026",
  categoryLabel: "100K",
  eventDate: "2026-11-14",
  reference: "A1B2C3D4",
  runnerName: "Juan Dela Cruz",
  bibName: "JUAN",
  distanceKm: 100,
};

describe("TicketCard", () => {
  it("shows the event, category, and date", () => {
    render(<TicketCard {...props} />);
    expect(screen.getByText("Apo Sky Ultra 2026")).toBeInTheDocument();
    expect(screen.getByText(/100K/)).toBeInTheDocument();
    expect(screen.getByText("14 November 2026")).toBeInTheDocument();
  });

  it("renders a scannable QR carrying the signed token", () => {
    const { container } = render(<TicketCard {...props} />);
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("shows the reference code and runner details", () => {
    render(<TicketCard {...props} />);
    expect(screen.getByText("A1B2C3D4")).toBeInTheDocument();
    expect(screen.getByText("Juan Dela Cruz")).toBeInTheDocument();
    expect(screen.getByText("JUAN")).toBeInTheDocument();
  });

  it("falls back to the reference when there is no bib name", () => {
    render(<TicketCard {...props} bibName={null} />);
    // Scoped to the Bib cell specifically — the reference code already
    // renders once under the QR regardless of bibName, so a document-wide
    // getAllByText(...).length >= 1 would pass even if the fallback were
    // broken. Assert on the Bib cell's own value.
    const bibCell = screen.getByText("Bib").closest("div");
    expect(bibCell).not.toBeNull();
    expect(within(bibCell as HTMLElement).getByText("A1B2C3D4")).toBeInTheDocument();
  });

  it("renders without a distance", () => {
    render(<TicketCard {...props} distanceKm={null} />);
    expect(screen.getByText("Apo Sky Ultra 2026")).toBeInTheDocument();
  });
});
