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

    const siteUrl = Deno.env.get("PUBLIC_SITE_URL") ?? "https://racepace.vercel.app";
    const functionsUrl = Deno.env.get("PUBLIC_FUNCTIONS_URL") ?? "";
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
