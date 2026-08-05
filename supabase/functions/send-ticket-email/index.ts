import { serviceClient } from "../_shared/supabase.ts";
import { renderTicketEmail, sendEmail } from "../_shared/email.ts";
import { isAuthorizedBearer } from "../_shared/authz.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// Invoked server-to-server from confirmPayment() — never from a browser, so
// no CORS handling here. `verify_jwt = false` in config.toml (the platform
// gate would otherwise reject the service-role JWT confirm.ts sends before
// this handler runs); TICKET_EMAIL_SECRET in the Authorization header is
// what replaces it, mirroring send-push's PUSH_CRON_SECRET. Without this a
// registration id — which appears in the /ticket/<rid> URL runners
// screenshot and share — was enough for anyone to mail-bomb that runner.
Deno.serve(async (req) => {
  const expected = Deno.env.get("TICKET_EMAIL_SECRET");
  if (!isAuthorizedBearer(req.headers.get("Authorization"), expected)) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    const { registration_id: registrationId } = await req.json().catch(() => ({}));
    if (!registrationId) return json({ error: "registration_id_required" }, 400);

    const db = serviceClient();
    const { data: reg } = await db
      .from("registrations")
      .select("id,user_id,status,total_amount,ticket_token,events(name,event_date,venue),categories(label)")
      .eq("id", registrationId)
      .single();

    if (!reg) return json({ error: "not_found" }, 404);
    if (reg.status !== "paid" || !reg.ticket_token) return json({ error: "not_paid" }, 409);

    const { data: userRes } = await db.auth.admin.getUserById(reg.user_id);
    const to = userRes?.user?.email;
    if (!to) return json({ error: "no_email" }, 422);

    // No defaults here on purpose. A wrong base URL is worse than no email:
    // PUBLIC_SITE_URL previously defaulted to a hostname owned by an unrelated
    // third party, so an unset secret would have mailed runners links to a
    // stranger's site; PUBLIC_FUNCTIONS_URL defaulted to "" and produced a
    // silently broken QR <img>. Misconfiguration must fail loudly and visibly.
    // Failing here is safe: confirmPayment() invokes this best-effort inside a
    // try/catch, so a captured payment still confirms.
    const siteUrl = Deno.env.get("PUBLIC_SITE_URL");
    const functionsUrl = Deno.env.get("PUBLIC_FUNCTIONS_URL");
    if (!siteUrl || !functionsUrl) {
      console.error("[send-ticket-email] missing config", {
        PUBLIC_SITE_URL: !!siteUrl,
        PUBLIC_FUNCTIONS_URL: !!functionsUrl,
      });
      return json({ error: "not_configured" }, 500);
    }
    const event = reg.events as { name: string; event_date: string | null; venue: string | null } | null;
    const category = reg.categories as { label: string } | null;

    const { subject, html } = renderTicketEmail({
      eventName: event?.name ?? "Your race",
      categoryLabel: category?.label ?? "",
      eventDate: event?.event_date ?? null,
      venue: event?.venue ?? null,
      reference: reg.id.slice(0, 8).toUpperCase(),
      ticketUrl: `${siteUrl}/ticket/${reg.id}`,
      qrUrl: `${functionsUrl}/ticket-qr?token=${encodeURIComponent(reg.ticket_token)}`,
      total: reg.total_amount,
    });

    const result = await sendEmail(to, subject, html);
    if (!result.ok) {
      console.error("[send-ticket-email] send failed", { registrationId, error: result.error });
      return json({ error: "send_failed", details: result.error }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    console.error("[send-ticket-email] unexpected", e);
    return json({ error: "server_error", details: String(e) }, 500);
  }
});
