import { z } from "zod";
import { emailBrandFooter, emailBrandHeader, isStagingEmail } from "../_shared/emailBrand.ts";

const inquirySchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  audience: z.enum(["runner", "organizer"]),
  subject: z.string().trim().min(2).max(160),
  message: z.string().trim().min(2).max(5000),
  website: z.string().max(200).optional().default(""),
});

export type Inquiry = z.infer<typeof inquirySchema>;

export function parseInquiry(input: unknown) {
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

function withBreaks(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

function audienceLabel(audience: Inquiry["audience"]): string {
  return audience === "runner" ? "Runner" : "Organizer";
}

export function renderInquiryNotification(input: Inquiry): {
  subject: string;
  html: string;
  text: string;
} {
  const name = oneLine(`${input.firstName} ${input.lastName}`);
  const email = oneLine(input.email);
  const suppliedSubject = oneLine(input.subject);
  const role = audienceLabel(input.audience);
  const subject = `${role} inquiry — ${suppliedSubject}`;
  const text = [
    `New ${role.toLowerCase()} inquiry`, "",
    `Contact: ${name}`,
    `Email: ${email}`,
    `Role: ${role}`,
    `Subject: ${suppliedSubject}`, "",
    input.message,
    "", "Submitted from the Race Pace landing page.",
  ].join("\n");

  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#eef1ef;font-family:Arial,Helvetica,sans-serif;color:#183b2a"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #dce4df">${emailBrandHeader("TEST — STAGING · Inquiry email")}<tr><td style="padding:32px 28px"><p style="margin:0 0 8px;color:#159a55;font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase">${role} inquiry</p><h1 style="margin:0 0 24px;font-size:26px;line-height:1.2">${escapeHtml(suppliedSubject)}</h1><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-collapse:collapse"><tr><td style="padding:9px 0;color:#657469">Contact</td><td align="right" style="padding:9px 0;font-weight:bold">${escapeHtml(name)}</td></tr><tr><td style="padding:9px 0;color:#657469">Email</td><td align="right" style="padding:9px 0">${escapeHtml(email)}</td></tr><tr><td style="padding:9px 0;color:#657469">Role</td><td align="right" style="padding:9px 0">${role}</td></tr></table><div style="margin:24px 0 0;padding:18px;background:#eef5f0;border:1px solid #dce4df;font-size:14px;line-height:1.7;color:#45574a">${withBreaks(input.message)}</div><p style="margin:20px 0 0;color:#657469;font-size:12px;line-height:1.6">Submitted from the Race Pace landing page. Reply to this message to contact ${escapeHtml(input.firstName)}.</p></td></tr>${emailBrandFooter()}</table></td></tr></table></body></html>`;

  return { subject, html, text };
}

export function renderInquiryAcknowledgement(input: Inquiry): {
  subject: string;
  html: string;
  text: string;
} {
  const firstName = oneLine(input.firstName);
  const suppliedSubject = oneLine(input.subject);
  const subject = "We received your Race Pace inquiry";
  const stagingLine = isStagingEmail() ? ["TEST — STAGING · Inquiry email", ""] : [];
  const text = [
    ...stagingLine,
    "RACE PACE", "", `Hi ${firstName},`, "",
    "Thank you for reaching out to Race Pace. We received your message and you will receive feedback from our team soon.", "",
    `Subject: ${suppliedSubject}`, "",
    "Race Pace · Your next starting line.",
  ].join("\n");

  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#eef1ef;font-family:Arial,Helvetica,sans-serif;color:#183b2a"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #dce4df">${emailBrandHeader("TEST — STAGING · Inquiry email")}<tr><td style="padding:32px 28px"><p style="margin:0 0 8px;color:#159a55;font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase">Inquiry received</p><h1 style="margin:0 0 16px;font-size:28px;line-height:1.2">Thank you for reaching out.</h1><p style="margin:0 0 20px;font-size:15px;line-height:1.75;color:#45574a">Hi ${escapeHtml(firstName)}, we received your message and you will receive feedback from our team soon.</p><div style="padding:16px 18px;background:#eef5f0;border:1px solid #dce4df;font-size:14px;line-height:1.6"><span style="color:#657469">Subject</span><br><strong>${escapeHtml(suppliedSubject)}</strong></div></td></tr>${emailBrandFooter()}</table></td></tr></table></body></html>`;

  return { subject, html, text };
}
