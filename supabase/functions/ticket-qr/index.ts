import QRCode from "qrcode";
import { preflight, corsHeaders } from "../_shared/cors.ts";

// Renders a ticket token as a PNG QR so the confirmation email can embed it
// with a plain <img src>. Unauthenticated by design: it only re-encodes a token
// the caller already has. Authorization for check-in lives in the check-in
// function, which requires status='paid' and a staff role for the event's org.
//
// errorCorrectionLevel "Q" and margin 4 (a 4-module quiet zone) match the
// QRCodeSVG settings apps/site/components/TicketCard.tsx uses for the printed
// ticket, so a scanner behaves identically against the page and the email.
Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const cors = corsHeaders(req.headers.get("Origin"));
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });

  const token = new URL(req.url).searchParams.get("token");
  if (!token) return json({ error: "token_required" }, 400);

  try {
    const png: Uint8Array = await QRCode.toBuffer(token, {
      type: "png",
      width: 512,
      margin: 4,
      errorCorrectionLevel: "Q",
    });

    return new Response(png, {
      status: 200,
      headers: {
        "content-type": "image/png",
        // A token's QR never changes, and email clients re-fetch aggressively.
        "cache-control": "public, max-age=31536000, immutable",
        ...cors,
      },
    });
  } catch (e) {
    console.error("[ticket-qr] render failed", e);
    return json({ error: "render_failed" }, 500);
  }
});
