import { emailBrandHeader, emailBrandFooter, isStagingEmail } from "./emailBrand.ts";
export type GroupTicket = { name: string; categoryLabel: string; reference: string; ticketUrl: string; qrUrl: string };
function escape(value: string) { return value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
export function renderGroupTicketEmail(input: { eventName: string; categoryLabel: string; eventDate: string | null; venue: string | null; total: number; tickets: GroupTicket[] }) {
  if (!Number.isSafeInteger(input.total) || input.total<0 || input.tickets.length<1 || input.tickets.length>10) throw new Error("invalid_ticket_email");
  const ticketCount = input.tickets.length;
  const runnerWord = ticketCount === 1 ? "runner" : "runners";
  const ticketWord = ticketCount === 1 ? "ticket" : "tickets";
  const cards=input.tickets.map((t,i)=>`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #dce4df;margin:14px 0 22px"><tr><td align="center" style="padding:20px"><p style="font-size:16px;font-weight:bold;margin:0 0 8px">${escape(t.name)}</p><p style="font-size:13px;color:#627267;margin:0 0 16px">${escape(t.categoryLabel)} · Ticket ${i+1} of ${input.tickets.length}</p><img src="${escape(t.qrUrl)}" width="200" height="200" alt="Ticket QR for ${escape(t.name)}" style="display:block;border:0;background:#fff" /><p style="font-size:12px;color:#657469;margin:16px 0">Reference: ${escape(t.reference)}</p><a href="${escape(t.ticketUrl)}" style="color:#148b4d">View and save this participant's ticket</a></td></tr></table>`).join("");
  const details=[input.eventDate,input.venue].filter(Boolean).join(" · ");
  const plain = (value: string) => value.replace(/\s+/g, " ").trim();
  const text = [
    ...(isStagingEmail() ? ["TEST — STAGING · This is not a real booking", ""] : []),
    "RACE PACE", "", `${ticketCount} ${runnerWord}. ${ticketCount} ${ticketWord}.`, "",
    `Event: ${plain(input.eventName)}`,
    `Category: ${plain(input.categoryLabel)}`,
    ...(details ? [`Date · venue: ${plain(details)}`] : []),
    `Original booking total: ₱${(input.total/100).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2})}`,
    "",
    ...input.tickets.flatMap((ticket, index) => [
      `Ticket ${index + 1} of ${ticketCount}: ${plain(ticket.name)}`,
      `Category: ${plain(ticket.categoryLabel)}`,
      `Reference: ${plain(ticket.reference)}`,
      `View this participant's ticket and QR: ${ticket.ticketUrl}`,
      "",
    ]),
    "Each participant has a separate QR. Keep each ticket for race-kit release and check-in where required.",
    "Race Pace · Your next starting line.",
    "Need help? support.racepace@gmail.com",
  ].join("\n");
  return {subject:`Your ${ticketCount} race ${ticketWord} — ${input.eventName}`,
    text,
    html:`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#eef1ef;font-family:Arial,Helvetica,sans-serif;color:#183b2a"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #dce4df">${emailBrandHeader()}<tr><td style="padding:32px 28px 16px"><h1 style="font-size:28px;line-height:1.2;margin:0 0 12px">${ticketCount} ${runnerWord}. ${ticketCount} ${ticketWord}.</h1><p style="font-size:17px;color:#159a55;margin:0 0 24px">One booking, everyone included.</p><p style="font-size:15px;line-height:1.75;color:#45574a">Your booking for ${escape(input.eventName)} has ${ticketCount} active participant ${ticketWord}. Each runner has a separate QR, including runners without an account.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-collapse:collapse;margin:24px 0"><tr><td style="padding:7px 0;color:#657469">Event</td><td align="right" style="padding:7px 0">${escape(input.eventName)}</td></tr><tr><td style="padding:7px 0;color:#657469">Category</td><td align="right" style="padding:7px 0">${escape(input.categoryLabel)}</td></tr>${details?`<tr><td style="padding:7px 0;color:#657469">Date · venue</td><td align="right" style="padding:7px 0">${escape(details)}</td></tr>`:""}<tr><td style="padding:7px 0;color:#657469">Original booking total</td><td align="right" style="padding:7px 0">₱${(input.total/100).toLocaleString("en-PH",{minimumFractionDigits:2,maximumFractionDigits:2})}</td></tr></table>${cards}<p style="font-size:12px;line-height:1.7;color:#657469;margin-top:24px">Each QR belongs to one participant. Keep it for race-kit release and check-in where required. Refunded tickets are excluded; refunds do not change the original booking total shown here.</p></td></tr>${emailBrandFooter()}</table></td></tr></table></body></html>`};
}
