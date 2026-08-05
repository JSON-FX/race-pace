export type TicketEmailInput = {
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

export function renderTicketEmail(input: TicketEmailInput): { subject: string; html: string } {
  const subject = `Your ${input.categoryLabel} race pass — ${input.eventName}`;
  const meta = [input.eventDate ? longDate(input.eventDate) : null, input.venue].filter(Boolean).join(" · ");

  // Table-based layout with inline styles: email clients strip <style> blocks
  // and have no flexbox or grid support worth relying on.
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;">
        <tr><td style="background:#0f2a20;padding:28px 28px 24px;">
          <p style="margin:0;font-size:11px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:#7FE0A6;">Race pass · ${esc(input.categoryLabel)}</p>
          <h1 style="margin:8px 0 0;font-size:24px;line-height:1.2;color:#ffffff;">${esc(input.eventName)}</h1>
          ${meta ? `<p style="margin:8px 0 0;font-size:14px;color:rgba(255,255,255,0.75);">${esc(meta)}</p>` : ""}
        </td></tr>
        <tr><td align="center" style="padding:32px 28px;">
          <img src="${esc(input.qrUrl)}" width="200" height="200" alt="Your ticket QR code" style="display:block;border:0;background:#ffffff;" />
          <p style="margin:16px 0 0;font-family:monospace;font-size:14px;letter-spacing:1px;color:#7a7a7a;">${esc(input.reference)}</p>
          <p style="margin:8px 0 0;font-size:14px;color:#1d1d1f;">Show this QR at check-in.</p>
        </td></tr>
        <tr><td style="padding:0 28px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e0e0e0;">
            <tr><td style="padding:14px 0;font-size:14px;color:#7a7a7a;">Total paid</td>
                <td align="right" style="padding:14px 0;font-size:14px;font-weight:600;color:#1d1d1f;">${peso(input.total)}</td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding:8px 28px 32px;">
          <a href="${esc(input.ticketUrl)}" style="display:inline-block;background:#159A55;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:14px 32px;border-radius:9999px;">View your ticket</a>
          <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#7a7a7a;">Save this email offline — trailheads rarely have signal.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  return { subject, html };
}

/** Resend's HTTP API — no SMTP client in Deno. Returns a result rather than
 *  throwing: a failed email must never fail a confirmed payment. */
export async function sendEmail(to: string, subject: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { ok: false, error: "resend_not_configured" };

  const from = Deno.env.get("EMAIL_FROM") ?? "Race Pace <tickets@racepace.ph>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "authorization": `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    if (!res.ok) return { ok: false, error: `resend_${res.status}: ${await res.text()}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
