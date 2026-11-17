import { afterEach, describe, expect, it, vi } from "vitest";
import { PAY_LATER_EMAIL_TYPES, renderPayLaterEmail, type PayLaterEmailInput } from "../functions/_shared/payLaterEmail.ts";

const input: PayLaterEmailInput = {
  type: "pay_later_granted", participantName: "Juan Dela Cruz", eventName: "Apo Ridge Trail",
  organizationName: "North Ridge Running", eventDate: "2027-03-21", categoryLabel: "21 km",
  dueAt: "2027-02-21T16:00:00Z", amountCents: 180000,
  actionUrl: "https://www.racepace.com.ph/ticket/entry",
};
afterEach(() => vi.unstubAllGlobals());

describe("approved Pay Later emails", () => {
  it.each(PAY_LATER_EMAIL_TYPES)("renders %s with brand, Philippine deadline and plain text", type => {
    const email = renderPayLaterEmail({ ...input, type });
    expect(email.html).toContain("Race Pace");
    expect(email.html).toContain("Hi Juan,");
    expect(email.html).toContain("February 21, 2027 at 11:59 p.m. Philippine time");
    expect(email.html).toContain(input.actionUrl);
    expect(email.text).toContain("February 21, 2027 at 11:59 p.m. Philippine time");
    expect(email.text).toContain("support.racepace@gmail.com");
    expect(email.text).not.toContain("<table");
  });
  it("distinguishes eligibility from a reserved slot and requires screening", () => {
    const { text } = renderPayLaterEmail(input);
    expect(text).toContain("pre-screening");
    expect(text).toContain("Your slot is held once you complete registration.");
    expect(text).not.toContain("Balance due");
  });
  it("keeps the unpaid check-in restriction and discloses provider fees", () => {
    const { text } = renderPayLaterEmail({ ...input, type: "pay_later_reserved", processingFeesAdditional: true });
    expect(text).toContain("₱1,800.00");
    expect(text).toContain("once your payment is confirmed");
    expect(text).toContain("Payment processing fees are calculated when you pay.");
  });
  it("invalidates without offering another payment and includes reconciliation guidance", () => {
    const { text, subject } = renderPayLaterEmail({ ...input, type: "pay_later_expired" });
    expect(subject).toBe("Your ticket for Apo Ridge Trail is no longer valid");
    expect(text).toContain("slot has been released");
    expect(text).toContain("can no longer be used for race entry or check-in");
    expect(text).toContain("If you already paid");
    expect(text).not.toContain("View payment:");
  });
  it("escapes user content and strips subject newlines", () => {
    const { html, subject } = renderPayLaterEmail({ ...input, eventName: '<img onerror="bad">\r\nBcc: bad', participantName: "<script>" });
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img onerror=&quot;bad&quot;&gt;");
    expect(html).not.toContain('<img onerror="bad">');
    expect(subject).not.toMatch(/[\r\n]/);
  });
  it("marks staging messages", () => {
    vi.stubGlobal("Deno", { env: { get: () => "staging" } });
    const email = renderPayLaterEmail(input);
    expect(email.subject).toMatch(/^\[STAGING\]/);
    expect(email.html).toContain("TEST — STAGING");
    expect(email.text).toContain("This is not a real booking");
  });
});
