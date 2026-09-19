import { z } from "zod";

const inquirySchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  organization: z.string().trim().min(2).max(160),
  website: z.string().max(200).optional().default(""),
});

export type OrganizerInquiry = z.infer<typeof inquirySchema>;

export function parseOrganizerInquiry(input: unknown) {
  return inquirySchema.safeParse(input);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
}

export function renderOrganizerInquiryEmail(input: OrganizerInquiry): {
  subject: string;
  html: string;
  text: string;
} {
  const name = oneLine(input.name);
  const email = oneLine(input.email);
  const organization = oneLine(input.organization);
  const subject = `Organizer inquiry — ${organization}`;
  const text = [
    "New organizer inquiry", "",
    `Contact: ${name}`,
    `Email: ${email}`,
    `Organization or race: ${organization}`,
    "",
    "Submitted from the Race Pace landing page.",
  ].join("\n");

  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#eef1ef;font-family:Arial,Helvetica,sans-serif;color:#183b2a"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #dce4df"><tr><td style="padding:28px"><p style="margin:0 0 8px;color:#159a55;font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase">Organizer inquiry</p><h1 style="margin:0 0 24px;font-size:26px;line-height:1.2">A race organizer wants to connect.</h1><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-collapse:collapse"><tr><td style="padding:9px 0;color:#657469">Contact</td><td align="right" style="padding:9px 0;font-weight:bold">${escapeHtml(name)}</td></tr><tr><td style="padding:9px 0;color:#657469">Email</td><td align="right" style="padding:9px 0">${escapeHtml(email)}</td></tr><tr><td style="padding:9px 0;color:#657469">Organization or race</td><td align="right" style="padding:9px 0">${escapeHtml(organization)}</td></tr></table><p style="margin:24px 0 0;color:#657469;font-size:12px;line-height:1.6">Submitted from the Race Pace landing page. Reply to this message to contact the organizer.</p></td></tr></table></td></tr></table></body></html>`;

  return { subject, html, text };
}
