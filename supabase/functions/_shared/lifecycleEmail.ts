import { emailBrandFooter, emailBrandHeader, isStagingEmail } from "./emailBrand.ts";

export type LifecycleEmailType =
  | "event_rescheduled"
  | "event_cancelled"
  | "event_updated"
  | "payment_failed"
  | "payment_expiring";

export type LifecycleEmailInput = {
  type: LifecycleEmailType;
  participantName?: string | null;
  eventName: string;
  categoryLabel?: string | null;
  eventDate?: string | null;
  previousEventDate?: string | null;
  venue?: string | null;
  statusNote?: string | null;
  changedFields?: string[];
  expiresAt?: string | null;
  actionUrl: string;
};

export type RenderedEmail = { subject: string; html: string; text: string };

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function plain(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dateOnly(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

function dateTime(value: string): string {
  return new Date(value).toLocaleString("en-PH", {
    dateStyle: "long", timeStyle: "short", timeZone: "Asia/Manila",
  });
}

const FIELD_LABELS: Record<string, string> = {
  name: "Event name",
  place: "Meeting point",
  venue: "Venue",
  region_name: "Region",
  province_name: "Province",
  city_name: "City",
  description: "Event instructions",
  schedule: "Race-day schedule",
  inclusions: "Entry inclusions",
  flag_off: "Flag-off time",
  elevation_gain_m: "Elevation details",
  cutoff_hours: "Cut-off time",
  registration_closes_at: "Registration deadline",
  kit_edit_closes_at: "Race-kit deadline",
  check_in_required: "Check-in requirements",
  status_note: "Organizer notice",
};

function fieldLabels(fields: string[] = []): string[] {
  return [...new Set(fields.map((field) => FIELD_LABELS[field]).filter((label): label is string => !!label))];
}

type Copy = {
  subject: string;
  heading: string;
  tagline: string;
  intro: string;
  button: string;
  note: string;
  facts: Array<[string, string]>;
};

function copyFor(input: LifecycleEmailInput): Copy {
  const name = plain(input.participantName ?? "Runner");
  const event = plain(input.eventName);
  const date = input.eventDate ? dateOnly(input.eventDate) : null;
  const venue = input.venue ? plain(input.venue) : null;
  const category = input.categoryLabel ? plain(input.categoryLabel) : null;
  const baseFacts: Array<[string, string]> = [["Event", event]];
  if (category) baseFacts.push(["Category", category]);
  if (date) baseFacts.push(["Event date", date]);
  if (venue) baseFacts.push(["Venue", venue]);

  switch (input.type) {
    case "event_rescheduled": {
      const facts = [...baseFacts];
      if (input.previousEventDate) facts.splice(1, 0, ["Previous date", dateOnly(input.previousEventDate)]);
      return {
        subject: `New date for ${event}`,
        heading: "Your event has a new date",
        tagline: "Please update your race-day plans.",
        intro: `${name}, the organizer has rescheduled ${event}. Review the latest event details before you travel.`,
        button: "Review new event date",
        note: "Your registration remains on your Race Passport. Contact the organizer if the new date affects your participation.",
        facts,
      };
    }
    case "event_cancelled":
      return {
        subject: `${event} has been cancelled`,
        heading: "Your event has been cancelled",
        tagline: "An important organizer update.",
        intro: `${name}, the organizer has cancelled ${event}. Review the organizer's notice and your current booking details.`,
        button: "Review cancellation",
        note: "Cancellation does not mean a refund has already been processed. Any refund status appears separately in Race Pace.",
        facts: input.statusNote ? [...baseFacts, ["Organizer notice", plain(input.statusNote)]] : baseFacts,
      };
    case "event_updated": {
      const labels = fieldLabels(input.changedFields);
      return {
        subject: `An update to ${event}`,
        heading: "An update to your event",
        tagline: "Please review before race day.",
        intro: `${name}, the organizer has updated important details for ${event}. Review the latest information before you travel.`,
        button: "View event update",
        note: "This is an event service message from the organizer through Race Pace.",
        facts: labels.length ? [...baseFacts, ["Updated details", labels.join(", ")]] : baseFacts,
      };
    }
    case "payment_failed":
      return {
        subject: `Payment unsuccessful — ${event}`,
        heading: "Your payment was unsuccessful",
        tagline: "Your card or wallet was not charged by this attempt.",
        intro: `${name}, we could not create a payment checkout for ${event}. You can return to Race Pace and start a new registration attempt.`,
        button: "Return to the event",
        note: "If your bank or wallet shows a charge, do not try again. Contact Race Pace support so the payment can be checked first.",
        facts: baseFacts,
      };
    case "payment_expiring": {
      const facts = [...baseFacts];
      if (input.expiresAt) facts.push(["Payment deadline", `${dateTime(input.expiresAt)} PHT`]);
      return {
        subject: `Complete payment soon — ${event}`,
        heading: "Your payment window is closing",
        tagline: "Complete payment to keep this registration.",
        intro: `${name}, your pending registration for ${event} expires in about two hours. Complete payment before the deadline if you still plan to join.`,
        button: "Complete payment",
        note: "If payment is not completed by the deadline, this reservation is released automatically. You may register again while entries remain available.",
        facts,
      };
    }
  }
}

export function renderLifecycleEmail(input: LifecycleEmailInput): RenderedEmail {
  const copy = copyFor(input);
  const text = [
    ...(isStagingEmail() ? ["TEST — STAGING · This is not a real booking", ""] : []),
    "RACE PACE", "", copy.heading.toUpperCase(), "", copy.tagline, "", copy.intro, "",
    ...copy.facts.map(([label, value]) => `${label}: ${value}`), "",
    `${copy.button}: ${input.actionUrl}`, "", copy.note, "",
    "Race Pace · Your next starting line.",
    "Need help? support.racepace@gmail.com",
  ].join("\n");
  const rows = copy.facts.map(([label, value]) =>
    `<tr><td style="padding:7px 0;color:#657469;vertical-align:top">${esc(label)}</td><td align="right" style="padding:7px 0 7px 20px">${esc(value)}</td></tr>`
  ).join("");
  const html = `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#eef1ef;font-family:Arial,Helvetica,sans-serif;color:#183b2a"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #dce4df">${emailBrandHeader()}<tr><td style="padding:32px 28px 16px"><h1 style="font-size:28px;line-height:1.2;margin:0 0 12px">${esc(copy.heading)}</h1><p style="font-size:17px;color:#159a55;margin:0 0 24px">${esc(copy.tagline)}</p><p style="font-size:15px;line-height:1.75;color:#45574a">${esc(copy.intro)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-collapse:collapse;margin:24px 0">${rows}</table><a href="${esc(input.actionUrl)}" style="display:inline-block;background:#148b4d;color:#fff;text-decoration:none;padding:15px 24px;border-radius:6px;font-weight:bold">${esc(copy.button)}</a><p style="font-size:12px;line-height:1.7;color:#657469;margin-top:24px">${esc(copy.note)}</p></td></tr>${emailBrandFooter()}</table></td></tr></table></body></html>`;
  return { subject: copy.subject, html, text };
}
