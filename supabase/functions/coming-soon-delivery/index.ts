import { renderPrescreeningEmail } from "../_shared/prescreeningEmail.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { isAuthorizedBearer } from "../_shared/authz.ts";
import { sendEmail } from "../_shared/email.ts";
import { renderComingSoonEmail } from "../_shared/comingSoonEmail.ts";

function siteBase(): string {
  const raw = Deno.env.get("PUBLIC_SITE_URL");
  if (!raw) throw new Error("site_url_missing");
  const url = new URL(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("site_url_invalid");
  }
  return url.toString().replace(/\/$/, "");
}

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });
  if (!isAuthorizedBearer(req.headers.get("Authorization"), Deno.env.get("TICKET_EMAIL_SECRET"))) {
    return json({ error: "unauthorized" }, 401);
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const site = siteBase();
    const db = serviceClient();
    const { data: jobs, error } = await db.rpc("coming_soon_email_claim", { p_limit: 1 });
    if (error) return json({ error: "claim_failed" }, 503);
    let sent = 0;
    let failed = 0;
    for (const job of jobs ?? []) {
      let failure: string | null = null;
      try {
        if (job.type === "prescreening_ready" || job.type === "prescreening_rejected" || job.type === "prescreening_submitted") {
          const [user, batch] = await Promise.all([
            db.auth.admin.getUserById(job.user_id),
            db.from("prescreening_batches").select("id,event_id,booked_by_user_id,status,checkout_intent,payment_deadline_at,events(name),prescreening_applications(id,participant_name,is_managed,decision,rejection_reason,categories(label))")
              .eq("id", job.payload.batch_id).single(),
          ]);
          if (user.error || !user.data.user?.email_confirmed_at || !user.data.user.email || batch.error ||
            batch.data.booked_by_user_id !== job.user_id || batch.data.event_id !== job.event_id) throw new Error("delivery_read_failed");
          const b = batch.data;
          const event = b.events as unknown as { name: string };
          const applications = b.prescreening_applications as unknown as {id:string;participant_name:string;is_managed:boolean;decision:string;rejection_reason:string|null;categories:{label:string}}[];
          const relevant = applications.filter(a => job.type === "prescreening_submitted" ? true : job.type === "prescreening_ready" ? a.decision !== "rejected" : a.id === job.payload.application_id);
          if (!relevant.length) throw new Error("delivery_read_failed");
          const message = renderPrescreeningEmail({ type: job.type, eventName: event.name,
            requestUrl: `${site}/prescreening/${b.id}`, intent: b.checkout_intent as "entry" | "reservation",
            participants: relevant.map(a => ({ name: a.participant_name, category: a.categories.label, decision: a.decision, managed: a.is_managed })),
            currentStatus: b.status === "ready" && b.payment_deadline_at && Date.parse(b.payment_deadline_at) <= Date.now() ? "expired" : b.status,
            reason: relevant[0].rejection_reason ?? undefined,
            deadline: b.payment_deadline_at ? new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "long", timeStyle: "short" }).format(new Date(b.payment_deadline_at)) : undefined,
          });
          const result = await sendEmail(user.data.user.email, message.subject, message.html, message.text,
            { idempotencyKey: `screening:${job.id}:${job.payload.delivery_id ?? "initial"}` });
          if (!result.ok) throw new Error("send_failed");
          sent++;
        } else {
        const [user, event, reservation] = await Promise.all([
          db.auth.admin.getUserById(job.user_id),
          db.from("events").select("id,name,slug,status,reservation_deadline_at").eq("id", job.event_id).single(),
          job.event_reservation_id
            ? db.from("event_reservations").select("id,status,registration_deadline_at,reservation_payments(amount_cents,status)")
              .eq("id", job.event_reservation_id).single()
            : Promise.resolve({ data: null, error: null }),
        ]);
        if (user.error || event.error || reservation.error || !user.data.user?.email_confirmed_at ||
          !user.data.user.email || !event.data) throw new Error("delivery_read_failed");
        if (job.type === "reservation_paid" && (!reservation.data ||
          !["paid", "converted", "expired"].includes(reservation.data.status))) {
          throw new Error("paid_reservation_required");
        }
        const payment = reservation.data
          ? (Array.isArray(reservation.data.reservation_payments)
            ? reservation.data.reservation_payments[0] : reservation.data.reservation_payments)
          : null;
        if (job.type === "reservation_paid" && payment?.status !== "paid") throw new Error("paid_payment_required");
        const deadlineAt = reservation.data?.registration_deadline_at ?? event.data.reservation_deadline_at;
        const deadline = deadlineAt ? new Intl.DateTimeFormat("en-PH", {
          timeZone: "Asia/Manila", day: "numeric", month: "long", year: "numeric",
          hour: "numeric", minute: "2-digit", hour12: true,
        }).format(new Date(deadlineAt)) : undefined;
        const eventUrl = `${site}/events/${encodeURIComponent(event.data.slug ?? event.data.id)}`;
        const message = renderComingSoonEmail({
          type: job.type, eventName: event.data.name, eventUrl,
          reservationUrl: reservation.data ? `${site}/reservations/${reservation.data.id}` : undefined,
          deadline, totalCents: payment?.amount_cents,
        });
        const result = await sendEmail(user.data.user.email, message.subject, message.html, message.text);
        if (!result.ok) throw new Error("send_failed");
        sent++;
        }
      } catch {
        failure = "delivery_failed";
        failed++;
      }
      const finished = await db.rpc("transactional_email_finish", {
        p_job: job.id, p_lease: job.lease_token, p_error: failure,
      });
      if (finished.error || finished.data !== true) return json({ error: "completion_unknown" }, 503);
    }
    return json({ sent, failed }, failed ? 503 : 200);
  } catch {
    return json({ error: "delivery_unavailable" }, 503);
  }
});
