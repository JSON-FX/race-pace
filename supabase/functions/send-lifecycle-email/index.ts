import { isAuthorizedBearer } from "../_shared/authz.ts";
import { sendEmail } from "../_shared/email.ts";
import { renderLifecycleEmail, type LifecycleEmailInput, type LifecycleEmailType } from "../_shared/lifecycleEmail.ts";
import { serviceClient } from "../_shared/supabase.ts";

type Job = {
  id: string;
  type: LifecycleEmailType;
  user_id: string;
  registration_id: string | null;
  event_id: string;
  payload: Record<string, unknown>;
  lease_token: string;
};

type Registration = {
  id: string;
  status: string;
  expires_at: string | null;
  custom_data: Record<string, unknown> | null;
  events: { name: string; status: string; event_date: string | null; venue: string | null; status_note: string | null } | null;
  categories: { label: string } | null;
  payments: { status: string } | Array<{ status: string }> | null;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function baseUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function paymentStatus(registration: Registration): string | null {
  const payment = Array.isArray(registration.payments) ? registration.payments[0] : registration.payments;
  return payment?.status ?? null;
}

function stale(job: Job, registration: Registration): boolean {
  const event = registration.events;
  if (!event) return true;
  if (job.type === "event_cancelled") return registration.status !== "paid" || event.status !== "cancelled";
  if (job.type === "event_rescheduled") {
    return registration.status !== "paid" || event.status === "cancelled" ||
      (typeof job.payload.event_date === "string" && event.event_date !== job.payload.event_date);
  }
  if (job.type === "event_updated") return registration.status !== "paid" || event.status === "cancelled";
  // Confirmed checkout rejection expires the registration in the same database
  // transaction after the failed-payment trigger queues this job.
  if (job.type === "payment_failed") return paymentStatus(registration) !== "failed";
  if (job.type === "payment_expiring") {
    return registration.status !== "pending" || paymentStatus(registration) !== "pending" ||
      !registration.expires_at || Date.parse(registration.expires_at) <= Date.now();
  }
  return true;
}

function inputFor(job: Job, registration: Registration, siteUrl: string): LifecycleEmailInput {
  const event = registration.events!;
  const paymentAction = job.type === "payment_expiring" ? `/pay/${registration.id}` : `/events/${job.event_id}`;
  const changedFields = Array.isArray(job.payload.changed_fields)
    ? job.payload.changed_fields.filter((field): field is string => typeof field === "string")
    : [];
  return {
    type: job.type,
    participantName: typeof registration.custom_data?.full_name === "string"
      ? registration.custom_data.full_name : null,
    eventName: event.name,
    categoryLabel: registration.categories?.label ?? null,
    eventDate: event.event_date,
    previousEventDate: typeof job.payload.previous_event_date === "string" ? job.payload.previous_event_date : null,
    venue: event.venue,
    statusNote: typeof job.payload.status_note === "string" ? job.payload.status_note : event.status_note,
    changedFields,
    expiresAt: registration.expires_at,
    actionUrl: `${siteUrl}${paymentAction}`,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (!isAuthorizedBearer(req.headers.get("Authorization"), Deno.env.get("TRANSACTIONAL_EMAIL_WORKER_SECRET"))) {
    return json({ error: "unauthorized" }, 401);
  }
  const siteUrl = baseUrl(Deno.env.get("PUBLIC_SITE_URL"));
  if (!siteUrl) return json({ error: "not_configured" }, 500);

  const db = serviceClient();
  const claimed = await db.rpc("transactional_email_claim", { p_limit: 10 });
  if (claimed.error) return json({ error: "claim_failed" }, 503);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const job of (claimed.data ?? []) as Job[]) {
    let error: string | null = null;
    try {
      const result = await db.from("registrations")
        .select("id,status,expires_at,custom_data,events(name,status,event_date,venue,status_note),categories(label),payments(status)")
        .eq("id", job.registration_id).single();
      const registration = result.data as Registration | null;
      if (result.error || !registration || stale(job, registration)) {
        skipped++;
      } else {
        const recipient = await db.auth.admin.getUserById(job.user_id);
        const to = recipient.data.user?.email;
        if (!to || !recipient.data.user?.email_confirmed_at) throw new Error("confirmed_recipient_required");
        const rendered = renderLifecycleEmail(inputFor(job, registration, siteUrl));
        const delivered = await sendEmail(to, rendered.subject, rendered.html, rendered.text, {
          idempotencyKey: `lifecycle/${job.id}`,
        });
        if (!delivered.ok) throw new Error("email_transport_failed");
        sent++;
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : "delivery_failed";
      if (!/^[a-z_]+$/.test(error)) error = "delivery_failed";
      failed++;
    }
    const finished = await db.rpc("transactional_email_finish", {
      p_job: job.id, p_lease: job.lease_token, p_error: error,
    });
    if (finished.error || finished.data !== true) return json({ error: "completion_unknown" }, 503);
  }
  return json({ claimed: (claimed.data ?? []).length, sent, skipped, failed }, failed ? 503 : 200);
});
