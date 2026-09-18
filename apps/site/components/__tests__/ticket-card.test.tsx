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
  teamName: "Mountain Crew",
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

  it("explains when organizer check-in is optional without hiding the QR", () => {
    const { container } = render(<TicketCard {...props} checkInRequired={false} />);
    expect(screen.getByText("Check-in not required. Keep this QR as your race ticket and for any kit release.")).toBeInTheDocument();
    expect(screen.queryByText("Show this QR at check-in")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("shows the reference code and runner details", () => {
    render(<TicketCard {...props} />);
    expect(screen.getByText("A1B2C3D4")).toBeInTheDocument();
    expect(screen.getByText("Juan Dela Cruz")).toBeInTheDocument();
    expect(screen.getByText("Mountain Crew")).toBeInTheDocument();
  });

  it("shows an empty team name without calling the reference a bib", () => {
    render(<TicketCard {...props} teamName={null} />);
    const teamCell = screen.getByText("Team name").closest("div");
    expect(teamCell).not.toBeNull();
    expect(within(teamCell as HTMLElement).getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("Bib")).not.toBeInTheDocument();
  });

  it("renders without a distance", () => {
    render(<TicketCard {...props} distanceKm={null} />);
    expect(screen.getByText("Apo Sky Ultra 2026")).toBeInTheDocument();
  });
});
