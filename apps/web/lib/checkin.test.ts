import { describe, it, expect } from "vitest";
import { bannerFor, wrongEventBanner, decodeTicketEventId } from "./checkin";

describe("bannerFor", () => {
  it("maps a fresh check-in to success", () => {
    const b = bannerFor({ status: 200, body: { ok: true, registration_id: "r1" } }, "Juan Dela Cruz", "100K Ultra");
    expect(b.tone).toBe("success");
    expect(b.title).toBe("Checked in");
    expect(b.detail).toBe("Juan Dela Cruz · 100K Ultra");
  });

  it("maps a repeat scan to muted", () => {
    const b = bannerFor({ status: 200, body: { ok: true, already: true } });
    expect(b.tone).toBe("muted");
    expect(b.title).toBe("Already checked in");
  });

  it("maps not_paid to error", () => {
    expect(bannerFor({ status: 409, body: { error: "not_paid" } })).toMatchObject({ tone: "error", title: "Not paid" });
  });

  it("maps invalid_ticket to error", () => {
    expect(bannerFor({ status: 400, body: { error: "invalid_ticket" } })).toMatchObject({ tone: "error", title: "Invalid ticket" });
  });

  it("maps forbidden to a cross-org message", () => {
    expect(bannerFor({ status: 403, body: { error: "forbidden" } })).toMatchObject({
      tone: "error", title: "Not authorized", detail: "This ticket belongs to another organization.",
    });
  });

  it("maps not_found to error", () => {
    expect(bannerFor({ status: 404, body: { error: "not_found" } })).toMatchObject({ tone: "error", title: "Ticket not recognised" });
  });

  it("maps a server failure to a retryable error", () => {
    expect(bannerFor({ status: 500, body: {} })).toMatchObject({ tone: "error", title: "Could not reach the server" });
  });
});

describe("wrongEventBanner", () => {
  it("names the event the ticket actually belongs to", () => {
    expect(wrongEventBanner("Kitanglad Skyrace")).toMatchObject({
      tone: "warn", title: "Wrong event", detail: "This ticket is for Kitanglad Skyrace.",
    });
  });
});

describe("decodeTicketEventId", () => {
  it("reads eid out of the token body without verifying the signature", () => {
    const body = btoa(JSON.stringify({ rid: "r1", eid: "e1", iat: 1 })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(decodeTicketEventId(`${body}.sig`)).toBe("e1");
  });

  it("returns null for a malformed token", () => {
    expect(decodeTicketEventId("not-a-token")).toBeNull();
  });
});
