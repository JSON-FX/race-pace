import { describe, expect, it } from "vitest";
import { parseOrganizerInquiry, renderOrganizerInquiryEmail } from "./message";

describe("organizer inquiry message", () => {
  it("normalizes a valid inquiry", () => {
    const result = parseOrganizerInquiry({
      name: "  Ana Runner  ",
      email: "  ANA@EXAMPLE.COM ",
      organization: "  North Ridge Events  ",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        name: "Ana Runner",
        email: "ana@example.com",
        organization: "North Ridge Events",
        website: "",
      });
    }
  });

  it("rejects malformed and oversized fields", () => {
    expect(parseOrganizerInquiry({ name: "A", email: "not-an-email", organization: "X" }).success).toBe(false);
    expect(parseOrganizerInquiry({
      name: "Organizer",
      email: "organizer@example.com",
      organization: "x".repeat(161),
    }).success).toBe(false);
  });

  it("escapes organizer-controlled values and strips subject line breaks", () => {
    const message = renderOrganizerInquiryEmail({
      name: "Ana <script>alert(1)</script>",
      email: "ana@example.com",
      organization: "North Ridge\r\nBcc: outsider@example.com",
      website: "",
    });

    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.subject).toBe("Organizer inquiry — North Ridge Bcc: outsider@example.com");
  });
});
