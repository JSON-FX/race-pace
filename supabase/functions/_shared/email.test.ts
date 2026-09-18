import { describe, it, expect, vi } from "vitest";
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

  it("keeps each ticket fact on its own line in the plain-text alternative", () => {
    const { text } = renderTicketEmail(input);
    expect(text).toContain("Event: Apo Sky Ultra 2026\nCategory: 100K\nDate · venue: 14 November 2026 · Kapatagan Base Camp\nTotal paid: ₱2,500.00");
    expect(text).toContain(`View your ticket: ${input.ticketUrl}`);
    expect(text).not.toContain("EventApo");
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

it("shows and escapes the participant name for helper bookings", () => {
 const {html}=renderTicketEmail({...input,participantName:"Guest <Runner>"});
 expect(html).toContain("Guest &lt;Runner&gt;");
 expect(html).not.toContain("Guest <Runner>");
});

it("brands tickets and respects organizers without check-in", () => {
  const { html } = renderTicketEmail(input);
  expect(html).toContain('alt="" role="presentation"');
  expect(html).toContain('https://www.racepace.com.ph/topnav-logo.png');
  expect(html).toContain('max-width:600px;background:#fff;border:1px solid #dce4df');
  expect(html).toContain('See you at the starting line.');
  expect(html).toContain('check-in where required');
  expect(html).not.toContain('Show this QR at check-in.');
});

it("uses the public staging logo and banner for staging ticket emails", () => {
  vi.stubGlobal("Deno", { env: { get: (name: string) => name === "EMAIL_ENVIRONMENT" ? "staging" : undefined } });
  try {
    const { html } = renderTicketEmail(input);
    expect(html).toContain("TEST — STAGING");
    expect(html).toContain("pepbmqomiailnnvvwupz.supabase.co/storage/v1/object/public/email-branding/topnav-logo.png");
  } finally {
    vi.unstubAllGlobals();
  }
});
