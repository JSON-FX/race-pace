import { describe, it, expect } from "vitest";
import { renderTicketEmail } from "./email";

const input = {
  eventName: "Apo Sky Ultra 2026",
  categoryLabel: "100K",
  eventDate: "2026-11-14",
  venue: "Kapatagan Base Camp",
  reference: "A1B2C3D4",
  ticketUrl: "https://racepace.vercel.app/ticket/r1",
  qrUrl: "https://x.supabase.co/functions/v1/ticket-qr?token=abc",
  total: 250000,
};

describe("renderTicketEmail", () => {
  it("names the event and category in the subject", () => {
    const { subject } = renderTicketEmail(input);
    expect(subject).toContain("Apo Sky Ultra 2026");
    expect(subject).toContain("100K");
  });

  it("embeds the QR as a real image URL, not a data URI", () => {
    const { html } = renderTicketEmail(input);
    expect(html).toContain(`src="${input.qrUrl}"`);
    expect(html).not.toContain("data:image");
  });

  it("links to the ticket page", () => {
    expect(renderTicketEmail(input).html).toContain(input.ticketUrl);
  });

  it("shows the reference, venue, and formatted total", () => {
    const { html } = renderTicketEmail(input);
    expect(html).toContain("A1B2C3D4");
    expect(html).toContain("Kapatagan Base Camp");
    expect(html).toContain("2,500.00");
  });

  it("renders without a date or venue", () => {
    const { html } = renderTicketEmail({ ...input, eventDate: null, venue: null });
    expect(html).toContain("Apo Sky Ultra 2026");
  });

  // An organizer-supplied event name reaches this template; unescaped it would
  // let stored HTML through into the runner's inbox.
  it("escapes HTML in the event name", () => {
    const { html } = renderTicketEmail({ ...input, eventName: '<script>alert(1)</script>' });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
