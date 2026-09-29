import { emailBrandHeader, emailBrandFooter, isStagingEmail } from "./emailBrand.ts";
const escape = (value: string) => value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
export function renderPrescreeningEmail(input: {
  type: "prescreening_ready" | "prescreening_rejected" | "prescreening_submitted"; eventName: string; requestUrl: string;
  participants: { name: string; category: string; decision?: string; managed?: boolean }[]; deadline?: string; reason?: string;
  intent: "entry" | "reservation"; currentStatus?: "ready" | "completed" | "cancelled" | "expired" | "reviewing";
}) {
  const ready = input.type === "prescreening_ready" && (!input.currentStatus || input.currentStatus === "ready");
  const submitted = input.type === "prescreening_submitted";
  const awaiting = submitted && (!input.currentStatus || input.currentStatus === "reviewing") &&
    input.participants.some(p => p.decision === "pending") && !input.participants.some(p => p.decision === "rejected");
  const outdated = (input.type === "prescreening_ready" && !ready) || (submitted && !awaiting);
  const title = awaiting ? "Your request is awaiting approval" : ready ? "Your group is ready to pay" : "An update on your pre-screening request";
  const subject = `${title} — ${input.eventName}`;
  const body = awaiting
    ? "We received your pre-screening request. All selected slots are secured while the organizer reviews the required proof, including slots for participants whose categories need no review. No entry or reservation payment is due now. We will email you when every remaining participant is ready to pay. Your 72-hour payment window has not started."
    : ready
    ? `All required pre-screening reviews are approved. Your selected Passports and categories are already saved. Complete one ${input.intent === "reservation" ? "reservation" : "entry"} payment by the deadline to keep these places.`
    : outdated ? "Your request has changed since this notification was queued. Open your request for its current booking and payment status. This email does not start or extend a payment window."
    : "The organizer did not approve the participant below. Only their slot has been released. Other participants keep their places and existing payment deadline. They may choose another available category, subject to availability.";
  const deadline = ready && input.deadline ? `Payment deadline: ${input.deadline} PHT. The 72-hour window began when the group became ready, not when this email arrived. Resending never extends it.` : "";
  const fee = ready && input.intent === "reservation" ? "The reservation fee is separate, nonrefundable, and is not deducted from full entry payment." : "";
  const reason = !submitted && !ready && !outdated && input.reason ? `Organizer’s reason: ${input.reason}` : "";
  const participantLine = (p: typeof input.participants[number]) => {
    const status = p.decision === "not_required" ? "No review needed — slot held with the group"
      : p.decision === "approved" ? "Approved — slot held"
      : p.decision === "rejected" ? "Rejected — slot released" : "Pending approval — slot held";
    return `${p.name} — ${p.category}${awaiting ? ` · ${p.managed ? "Managed Passport" : "Your Passport"} · ${status}` : ""}`;
  };
  const text = [isStagingEmail() ? "TEST — STAGING" : "",title,input.eventName,body,
    ...input.participants.map(participantLine),deadline,fee,reason,"Sign in with the booking account to view this request:",input.requestUrl].filter(Boolean).join("\n\n");
  const html = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;margin:auto;font-family:Arial,sans-serif">${emailBrandHeader()}<tr><td style="padding:32px 28px;color:#183b2a;background:#fff"><h1 style="font-size:28px;line-height:1.2">${escape(title)}</h1><p style="font-weight:bold">${escape(input.eventName)}</p><p style="font-size:15px;line-height:1.7">${escape(body)}</p><ul>${input.participants.map(p => `<li style="padding:7px 0">${escape(participantLine(p))}</li>`).join("")}</ul>${[deadline,fee,reason].filter(Boolean).map(p => `<p style="font-size:14px;line-height:1.7">${escape(p)}</p>`).join("")}<a href="${escape(input.requestUrl)}" style="display:inline-block;padding:14px 22px;background:#166344;color:white;border-radius:6px;text-decoration:none;font-weight:bold">View my request</a><p style="font-size:12px;line-height:1.6">Sign in with the booking account to see every Passport and its current review status.</p></td></tr>${emailBrandFooter()}</table>`;
  return { subject,html,text };
}
