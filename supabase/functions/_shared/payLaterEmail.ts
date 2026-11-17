import { emailBrandFooter, emailBrandHeader, isStagingEmail } from "./emailBrand.ts";
import type { RenderedEmail } from "./lifecycleEmail.ts";

export const PAY_LATER_EMAIL_TYPES = [
  "pay_later_granted", "pay_later_reserved", "pay_later_reminder_7d",
  "pay_later_reminder_1d", "pay_later_expired",
] as const;
export type PayLaterEmailType = typeof PAY_LATER_EMAIL_TYPES[number];
export function isPayLaterEmail(type: string): type is PayLaterEmailType {
  return (PAY_LATER_EMAIL_TYPES as readonly string[]).includes(type);
}

export type PayLaterEmailInput = {
  type: PayLaterEmailType;
  participantName: string;
  eventName: string;
  organizationName: string;
  eventDate: string;
  categoryLabel?: string;
  dueAt: string;
  amountCents?: number;
  processingFeesAdditional?: boolean;
  actionUrl: string;
};

function esc(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function date(value: Date): string {
  return value.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Manila" });
}

/** Matches the approved five-message preview; the stored cutoff is exclusive. */
export function renderPayLaterEmail(input: PayLaterEmailInput): RenderedEmail {
  const dueDate = date(new Date(Date.parse(input.dueAt) - 1));
  const cutoff = `${dueDate} at 11:59 p.m. Philippine time`;
  const event = input.eventName;
  const category = input.categoryLabel ?? "race";
  const balance = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format((input.amountCents ?? 0) / 100);
  const feeNote = input.processingFeesAdditional ? " Payment processing fees are calculated when you pay." : "";
  const expiry = "If payment is still outstanding after the deadline, your reservation expires and your slot becomes available to another runner.";
  let subject: string;
  let preheader: string;
  let heading: string;
  let body: string;
  let action: string;
  let note: string;
  let details: Array<[string, string]>;
  if (input.type === "pay_later_granted") {
    subject = `Pay Later approved for ${event}`;
    preheader = "Choose your category and finish registration to hold a slot.";
    heading = "You can now register with Pay Later";
    body = `${input.organizationName} has approved you for Pay Later at ${event}. Choose an available distance and complete registration to reserve your spot. If your category requires pre-screening, you’ll need the organizer’s approval for that distance first.`;
    details = [["Event day", date(new Date(`${input.eventDate}T00:00:00+08:00`))], ["Payment deadline", cutoff]];
    action = "Choose my category";
    note = "Your slot is held once you complete registration.";
  } else if (input.type === "pay_later_expired") {
    subject = `Your ticket for ${event} is no longer valid`;
    preheader = "The payment deadline passed. Your reservation has expired and your slot has been released.";
    heading = "Your ticket is no longer valid";
    body = `We did not receive payment for your ${category} entry at ${event} by ${cutoff}. Your reservation has expired and your slot has been released. This ticket can no longer be used for race entry or check-in.`;
    details = [["Event", event], ["Category", category], ["Status", "Expired · ticket invalid"], ["Payment deadline", cutoff]];
    action = "View my registration";
    note = "If you already paid, contact Race Pace support with your payment reference so we can check your registration.";
  } else {
    details = [["Event", event], ["Category", category], ["Balance due", balance], ["Pay by", cutoff]];
    note = expiry + feeNote;
    if (input.type === "pay_later_reserved") {
      subject = `Your ${category} slot is reserved for ${event}`;
      preheader = `Your place is held. Pay ${balance} by ${dueDate} to keep it.`;
      heading = "Your slot is reserved";
      body = `We’re holding a ${category} place for you at ${event}. You can pay from My Races any time through the deadline below. Your check-in code will be available once your payment is confirmed.`;
      action = "View my reservation";
    } else {
      const tomorrow = input.type === "pay_later_reminder_1d";
      subject = `${event} payment is due ${tomorrow ? "tomorrow" : "in 7 days"}`;
      preheader = `${balance} is due by ${cutoff}.`;
      heading = tomorrow ? "Your payment is due tomorrow" : "One week to pay for your race";
      body = tomorrow
        ? `Tomorrow is the last day to keep your ${category} slot at ${event}. Please pay ${balance} by ${cutoff}.`
        : `Your ${category} slot at ${event} is being held for you. You have seven days to pay the remaining ${balance}.`;
      action = "View payment";
    }
  }
  const greeting = `Hi ${input.participantName.trim().split(/\s+/)[0] || "runner"},`;
  const text = [isStagingEmail() ? "TEST — STAGING · This is not a real booking" : "", heading, greeting, body,
    ...details.map(([label, value]) => `${label}: ${value}`), `${action}: ${input.actionUrl}`, note,
    "Need help? Contact support.racepace@gmail.com."].filter(Boolean).join("\n\n");
  const rows = details.map(([label, value]) => `<tr><td style="width:32%;vertical-align:top;padding:7px 8px 7px 0;border-bottom:1px solid #e4ebe6;color:#55665a">${esc(label)}</td><td style="text-align:right;padding:7px 0;border-bottom:1px solid #e4ebe6;font-weight:600">${esc(value)}</td></tr>`).join("");
  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#eef1ef;font:15px/1.65 Arial,Helvetica,sans-serif;color:#183b2a"><div style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;border:1px solid #dce4df;background:#fff">${emailBrandHeader()}<tr><td style="padding:24px 26px 26px"><h1 style="font:bold 27px/1.22 Arial,sans-serif;margin:0 0 15px">${esc(heading)}</h1><p style="margin:0 0 10px">${esc(greeting)}</p><p style="margin:0 0 18px">${esc(body)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;margin:0 0 20px">${rows}</table><a href="${esc(input.actionUrl)}" style="display:inline-block;padding:12px 20px;background:#166344;color:#fff;border-radius:6px;text-decoration:none;font-weight:700;font-size:15px">${esc(action)}</a><p style="font-size:13px;line-height:1.6;color:#506453;margin:16px 0 0">${esc(note)}</p></td></tr>${emailBrandFooter()}</table></td></tr></table></body></html>`;
  return { subject: `${isStagingEmail() ? "[STAGING] " : ""}${subject.replace(/[\r\n]+/g, " ")}`, html, text };
}
