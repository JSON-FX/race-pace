import { preflight, corsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/email.ts";
import { parseOrganizerInquiry, renderOrganizerInquiryEmail } from "./message.ts";

const INQUIRY_RECIPIENT = "inquiries@racepace.com.ph";

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;

  const cors = corsHeaders(req.headers.get("Origin"));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });

  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 4096) {
    return json({ error: "payload_too_large" }, 413);
  }

  try {
    const body = await req.json().catch(() => null);
    const parsed = parseOrganizerInquiry(body);
    if (!parsed.success) return json({ error: "invalid_input" }, 400);

    // Quietly accept the hidden honeypot so automated submissions cannot use
    // the response to tune around it. No message is delivered in this branch.
    if (parsed.data.website) return json({ ok: true });

    const message = renderOrganizerInquiryEmail(parsed.data);
    const delivery = await sendEmail(
      INQUIRY_RECIPIENT,
      message.subject,
      message.html,
      message.text,
      { replyTo: parsed.data.email },
    );

    if (!delivery.ok) {
      console.error("[organizer-inquiry] delivery failed", { error: delivery.error });
      return json({ error: "delivery_failed" }, 502);
    }

    return json({ ok: true });
  } catch (error) {
    console.error("[organizer-inquiry] unexpected failure", {
      name: error instanceof Error ? error.name : "unknown",
    });
    return json({ error: "server_error" }, 500);
  }
});
