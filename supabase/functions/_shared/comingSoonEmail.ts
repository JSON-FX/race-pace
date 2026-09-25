import { emailBrandFooter, emailBrandHeader, isStagingEmail } from "./emailBrand.ts";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function renderComingSoonEmail(input: {
  type: "coming_soon_opened" | "reservation_paid";
  eventName: string;
  eventUrl: string;
  reservationUrl?: string;
  deadline?: string;
  totalCents?: number;
}) {
  const opened = input.type === "coming_soon_opened";
  const subject = opened ? `Registration is open — ${input.eventName}` : `Your event place is reserved — ${input.eventName}`;
  const title = opened ? "REGISTRATION IS OPEN" : "YOUR PLACE IS RESERVED";
  const body = opened
    ? `Registration for ${input.eventName} is open. Choose an available category and complete payment to secure your entry.`
    : `Your reservation for ${input.eventName} is paid. Choose an available category when registration opens, then complete entry payment before the deadline. Your reservation fee is separate from registration and is nonrefundable.`;
  const deadline = input.deadline ? `Entry payment deadline: ${input.deadline} PHT.` : "";
  const total = input.totalCents == null ? "" : `Amount paid: ₱${(input.totalCents / 100).toFixed(2)}.`;
  const href = opened ? input.eventUrl : input.reservationUrl ?? input.eventUrl;
  const text = [isStagingEmail() ? "TEST — STAGING" : "", "RACE PACE", title, body, deadline, total, href]
    .filter(Boolean).join("\n\n");
  const html = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;margin:auto;font-family:Arial,sans-serif">${emailBrandHeader()}<tr><td style="padding:32px 28px;background:#f8faf8;color:#14241b">
    <p style="color:#168257;font-size:12px;letter-spacing:2px;font-weight:700">${title}</p>
    <h1 style="font-size:28px;line-height:1.12;margin:12px 0 20px">${escapeHtml(input.eventName)}</h1>
    <p style="font-size:16px;line-height:1.6">${escapeHtml(body)}</p>
    ${deadline ? `<p style="font-size:15px">${escapeHtml(deadline)}</p>` : ""}
    ${total ? `<p style="font-size:15px">${escapeHtml(total)}</p>` : ""}
    <a href="${escapeHtml(href)}" style="display:inline-block;background:#15734b;color:white;text-decoration:none;border-radius:24px;padding:13px 24px;margin-top:16px;font-weight:700">${opened ? "View event" : "View reservation"}</a>
  </td></tr>${emailBrandFooter()}</table>`;
  return { subject, html, text };
}
