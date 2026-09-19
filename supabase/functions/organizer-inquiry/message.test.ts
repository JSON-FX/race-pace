import { describe, expect, it } from "vitest";
import {
  parseInquiry,
  renderInquiryAcknowledgement,
  renderInquiryNotification,
} from "./message";

const inquiry = {
  firstName: "Ana",
  lastName: "Runner",
  email: "ana@example.com",
  audience: "runner" as const,
  subject: "Registration payment",
  message: "Please help me verify my payment.",
  website: "",
};

describe("inquiry message", () => {
  it("normalizes a valid inquiry", () => {
    const result = parseInquiry({
      ...inquiry,
      firstName: "  Ana  ",
      lastName: "  Runner  ",
      email: "  ANA@EXAMPLE.COM ",
      subject: "  Registration payment  ",
      message: "  Please help me verify my payment.  ",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(inquiry);
  });

  it("rejects malformed roles and oversized content", () => {
    expect(parseInquiry({ ...inquiry, audience: "sponsor" }).success).toBe(false);
    expect(parseInquiry({ ...inquiry, subject: "x".repeat(161) }).success).toBe(false);
    expect(parseInquiry({ ...inquiry, message: "x".repeat(5001) }).success).toBe(false);
  });

  it("includes every inquiry field and escapes user-controlled HTML", () => {
    const notification = renderInquiryNotification({
      ...inquiry,
      firstName: "Ana <script>alert(1)</script>",
      subject: "Payment\r\nBcc: outsider@example.com",
      message: "Hello <strong>team</strong>\nSecond line",
    });

    expect(notification.subject).toBe("Runner inquiry — Payment Bcc: outsider@example.com");
    expect(notification.html).not.toContain("<script>");
    expect(notification.html).not.toContain("<strong>team</strong>");
    expect(notification.html).toContain("&lt;strong&gt;team&lt;/strong&gt;<br>Second line");
    expect(notification.text).toContain("Role: Runner");
    expect(notification.text).toContain("Subject: Payment Bcc: outsider@example.com");
  });

  it("renders the requested thank-you acknowledgement", () => {
    const acknowledgement = renderInquiryAcknowledgement(inquiry);

    expect(acknowledgement.subject).toBe("We received your Race Pace inquiry");
    expect(acknowledgement.html).toContain("Thank you for reaching out.");
    expect(acknowledgement.html).toContain("you will receive feedback from our team soon");
    expect(acknowledgement.text).toContain("Subject: Registration payment");
  });
});
