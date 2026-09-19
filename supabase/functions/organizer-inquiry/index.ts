import { preflight, corsHeaders } from "../_shared/cors.ts";
import { sendEmail } from "../_shared/email.ts";
import { checkOrganizerInquiryRateLimit, inquiryClientIp } from "../_shared/inquiryRateLimit.ts";
import { recaptchaConfigFromEnv, verifyRecaptchaEnterprise } from "../_shared/recaptcha.ts";
import { serviceClient } from "../_shared/supabase.ts";
import {
  parseInquiry,
  renderInquiryAcknowledgement,
  renderInquiryNotification,
} from "./message.ts";

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
  if (Number.isFinite(contentLength) && contentLength > 16384) {
    return json({ error: "payload_too_large" }, 413);
  }

  try {
    const body = await req.json().catch(() => null);
    const parsed = parseInquiry(body);
    if (!parsed.success) return json({ error: "invalid_input" }, 400);

    // Quietly accept the hidden honeypot so automated submissions cannot use
    // the response to tune around it. No message is delivered in this branch.
    if (parsed.data.website) return json({ ok: true });

    const captchaToken = typeof body === "object" && body !== null
      ? (body as Record<string, unknown>).captchaToken
      : undefined;
    const captcha = await verifyRecaptchaEnterprise(
      captchaToken,
      "organizer_inquiry",
      recaptchaConfigFromEnv((key) => Deno.env.get(key)),
    );
    if (!captcha.ok) {
      console.warn("[organizer-inquiry] captcha rejected", { reason: captcha.reason });
      return json({ error: "verification_failed" }, captcha.reason === "provider" || captcha.reason === "configuration" ? 503 : 403);
    }

    const rateLimit = await checkOrganizerInquiryRateLimit({
      client: serviceClient(),
      salt: Deno.env.get("INQUIRY_RATE_LIMIT_SALT"),
      ipAddress: inquiryClientIp(req.headers),
      email: parsed.data.email,
    });
    if (!rateLimit.ok) return json({ error: "too_many_requests" }, 429);

    const notification = renderInquiryNotification(parsed.data);
    const notificationDelivery = await sendEmail(
      INQUIRY_RECIPIENT,
      notification.subject,
      notification.html,
      notification.text,
      { replyTo: parsed.data.email },
    );

    if (!notificationDelivery.ok) {
      console.error("[organizer-inquiry] notification delivery failed", { error: notificationDelivery.error });
      return json({ error: "delivery_failed" }, 502);
    }

    const acknowledgement = renderInquiryAcknowledgement(parsed.data);
    const acknowledgementDelivery = await sendEmail(
      parsed.data.email,
      acknowledgement.subject,
      acknowledgement.html,
      acknowledgement.text,
      { replyTo: INQUIRY_RECIPIENT },
    );

    if (!acknowledgementDelivery.ok) {
      console.error("[organizer-inquiry] acknowledgement delivery failed", { error: acknowledgementDelivery.error });
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
