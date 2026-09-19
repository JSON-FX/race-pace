import { emailBrandHeader, emailBrandFooter, isStagingEmail } from "./emailBrand.ts";

export type TicketEmailInput = {
  participantName?: string | null;
  eventName: string;
  categoryLabel: string;
  eventDate: string | null;
  venue: string | null;
  reference: string;
  ticketUrl: string;
  qrUrl: string;
  /** Integer centavos. */
  total: number;
};

/** Event names and venues are organizer-supplied and land in a runner's inbox —
 *  escape before interpolating. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function peso(centavos: number): string {
  return "₱" + (centavos / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

function plain(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function renderTicketEmail(input: TicketEmailInput): { subject: string; html: string; text: string } {
  const subject = `Your ${input.categoryLabel} race pass — ${input.eventName}`;
  const meta = [input.eventDate ? longDate(input.eventDate) : null, input.venue].filter(Boolean).join(" · ");
  const text = [
    ...(isStagingEmail() ? ["TEST — STAGING · This is not a real booking", ""] : []),
    "RACE PACE", "", "YOUR RACE TICKET", "",
    `${plain(input.participantName ?? "Runner")}, here is your ticket for ${plain(input.eventName)}.`, "",
    `Event: ${plain(input.eventName)}`,
    `Category: ${plain(input.categoryLabel)}`,
    ...(meta ? [`Date · venue: ${plain(meta)}`] : []),
    `Total paid: ${peso(input.total)}`, "",
    `Runner: ${plain(input.participantName ?? "Participant")}`,
    `Reference: ${plain(input.reference)}`,
    `View your ticket: ${input.ticketUrl}`, "",
    "The ticket page includes your QR for race-kit release and check-in where required.",
    "Race Pace · Your next starting line.",
    "Need help? support.racepace@gmail.com",
  ].join("\n");

  // The approved proposal uses one table shell across Auth and ticket mail.
  // Keep every value escaped because event and participant text is user supplied.
  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#eef1ef;font-family:Arial,Helvetica,sans-serif;color:#183b2a"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #dce4df">${emailBrandHeader()}<tr><td style="padding:32px 28px 16px"><h1 style="font-size:28px;line-height:1.2;margin:0 0 12px">Your race ticket</h1><p style="font-size:17px;color:#159a55;margin:0 0 24px">See you at the starting line.</p><p style="font-size:15px;line-height:1.75;color:#45574a">${input.participantName ? `${esc(input.participantName)}, here is your ticket` : "Here is your ticket"} for ${esc(input.eventName)}. Keep a copy available on your phone for race day.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-collapse:collapse;margin:24px 0"><tr><td style="padding:7px 0;color:#657469">Event</td><td align="right" style="padding:7px 0">${esc(input.eventName)}</td></tr><tr><td style="padding:7px 0;color:#657469">Category</td><td align="right" style="padding:7px 0">${esc(input.categoryLabel)}</td></tr>${meta ? `<tr><td style="padding:7px 0;color:#657469">Date · venue</td><td align="right" style="padding:7px 0">${esc(meta)}</td></tr>` : ""}<tr><td style="padding:7px 0;color:#657469">Total paid</td><td align="right" style="padding:7px 0">${peso(input.total)}</td></tr></table><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dce4df;margin:14px 0 22px"><tr><td align="center" style="padding:20px"><p style="font-size:16px;font-weight:bold;margin:0 0 8px">${esc(input.participantName ?? "Participant")}</p><p style="font-size:13px;color:#627267;margin:0 0 16px">${esc(input.categoryLabel)} · ${esc(input.reference)}</p><img src="${esc(input.qrUrl)}" width="200" height="200" alt="Ticket QR for ${esc(input.participantName ?? "participant")}" style="display:block;border:0;background:#fff" /><p style="font-size:12px;color:#657469;margin:16px 0 0">Reference: ${esc(input.reference)}</p></td></tr></table><a href="${esc(input.ticketUrl)}" style="display:inline-block;background:#148b4d;color:#fff;text-decoration:none;padding:15px 24px;border-radius:6px;font-weight:bold">View your ticket</a><p style="font-size:12px;line-height:1.7;color:#657469;margin-top:24px">Keep this QR for race-kit release and check-in where required. Save your ticket before race day.</p></td></tr>${emailBrandFooter()}</table></td></tr></table></body></html>`;

  return { subject, html, text };
}

/** Explicit sandbox transport for local QA; Resend remains the default. Returns a result rather than
 *  throwing: a failed email must never fail a confirmed payment. */
export type SendEmailOptions = { replyTo?: string };

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  text?: string,
  options: SendEmailOptions = {},
): Promise<{ ok: boolean; error?: string }> {
  const provider = Deno.env.get("EMAIL_PROVIDER") ?? "resend";
  if (provider === "mailtrap" || provider === "mailpit") {
    const user = Deno.env.get("MAILTRAP_SMTP_USER");
    const pass = Deno.env.get("MAILTRAP_SMTP_PASSWORD");
    if (provider === "mailtrap" && (!user || !pass)) return { ok: false, error: "mailtrap_not_configured" };
    try {
      const { default: nodemailer } = await import("npm:nodemailer@10.0.10");
      const transport = nodemailer.createTransport({
        ...(provider === "mailtrap"
          ? { host: "sandbox.smtp.mailtrap.io", port: 2525, requireTLS: true, auth: { user, pass } }
          : { host: Deno.env.get("MAILPIT_SMTP_HOST") ?? "inbucket", port: 1025, ignoreTLS: true }),
        secure: false,
        connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
        disableFileAccess: true, disableUrlAccess: true,
      });
      try {
        const result = await transport.sendMail({
          from: Deno.env.get("EMAIL_FROM") ?? "Race Pace QA <qa@racepace.test>",
          to, subject, html, ...(text ? { text } : {}), ...(options.replyTo ? { replyTo: options.replyTo } : {}),
        });
        return result.accepted.length > 0 ? { ok: true } : { ok: false, error: `${provider}_rejected` };
      } finally { transport.close(); }
    } catch (error) {
      // Log only the transport category, never credentials or message content.
      console.error("[email] SMTP transport failed", { provider, code: (error as { code?: string }).code ?? "unknown" });
      return { ok: false, error: `${provider}_send_failed` };
    }
  }
  if (provider !== "resend") return { ok: false, error: "email_provider_invalid" };
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { ok: false, error: "resend_not_configured" };

  const from = Deno.env.get("EMAIL_FROM") ?? "Race Pace <tickets@racepace.ph>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        ...(text ? { text } : {}),
        ...(options.replyTo ? { reply_to: options.replyTo } : {}),
      }),
    });
    if (!res.ok) return { ok: false, error: `resend_${res.status}: ${await res.text()}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
