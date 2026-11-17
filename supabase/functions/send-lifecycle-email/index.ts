import { isAuthorizedBearer } from "../_shared/authz.ts";
import { sendEmail } from "../_shared/email.ts";
import { renderLifecycleEmail, type LifecycleEmailInput, type LifecycleEmailType } from "../_shared/lifecycleEmail.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { isPayLaterEmail, renderPayLaterEmail, type PayLaterEmailInput, type PayLaterEmailType } from "../_shared/payLaterEmail.ts";

type Job = {
  id: string;
  type: LifecycleEmailType | PayLaterEmailType;
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
    type: job.type as LifecycleEmailType,
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

type PayLaterRegistration = Omit<Registration, "payments"> & {
  user_id: string;
  pay_later_grant_id: string | null;
  pay_later_due_at: string | null;
  total_amount: number;
  event_id: string;
  organizations: { is_active: boolean } | null;
  payments: ({ status: string; amount: number; checkout_provider_managed_fee: boolean } |
    Array<{ status: string; amount: number; checkout_provider_managed_fee: boolean }>) | null;
};

async function payLaterInput(job: Job, db: ReturnType<typeof serviceClient>, siteUrl: string): Promise<PayLaterEmailInput | null> {
  if (!isPayLaterEmail(job.type)) return null;
  const dueAt = job.payload.due_at;
  const grantId = job.payload.grant_id;
  if (typeof dueAt !== "string" || typeof grantId !== "string" || !Number.isFinite(Date.parse(dueAt))) {
    throw new Error("invalid_pay_later_job");
  }
  const cutoff = Date.parse(dueAt);
  if (job.type === "pay_later_granted") {
    const result = await db.from("pay_later_grants")
      .select("id,user_id,event_id,due_at,registration_id,events(name,status,event_date,registration_closes_at),organizations(name,is_active)")
      .eq("id", grantId).maybeSingle();
    if (result.error) throw new Error("grant_read_failed");
    const grant = result.data as unknown as { user_id: string; event_id: string; due_at: string; registration_id: string | null;
      events: { name: string; status: string; event_date: string; registration_closes_at: string | null };
      organizations: { name: string; is_active: boolean } } | null;
    if (!grant || grant.user_id !== job.user_id || grant.event_id !== job.event_id ||
      Date.parse(grant.due_at) !== cutoff || cutoff <= Date.now() || !grant.organizations?.is_active ||
      !grant.events || grant.registration_id || !["open", "almost_full"].includes(grant.events.status) ||
      (grant.events.registration_closes_at && Date.parse(grant.events.registration_closes_at) <= Date.now())) return null;
    const claimed = await db.from("registrations").select("id").eq("user_id", job.user_id)
      .eq("event_id", job.event_id).in("status", ["pending", "paid"]).limit(1).maybeSingle();
    if (claimed.error) throw new Error("registration_read_failed");
    if (claimed.data) return null;
    return { type: job.type, participantName: "", eventName: grant.events.name,
      organizationName: grant.organizations.name, eventDate: grant.events.event_date,
      dueAt, actionUrl: `${siteUrl}/events/${job.event_id}` };
  }
  const result = await db.from("registrations")
    .select("id,user_id,event_id,status,expires_at,custom_data,total_amount,pay_later_grant_id,pay_later_due_at,events(name,status,event_date,venue,status_note),categories(label),payments(status,amount,checkout_provider_managed_fee),organizations(is_active)")
    .eq("id", job.registration_id).maybeSingle();
  if (result.error) throw new Error("registration_read_failed");
  const registration = result.data as unknown as PayLaterRegistration | null;
  if (!registration || registration.user_id !== job.user_id || registration.event_id !== job.event_id || registration.pay_later_grant_id !== grantId ||
    Date.parse(registration.pay_later_due_at ?? "") !== cutoff || !registration.events ||
    registration.events.status === "cancelled") return null;
  const payment = Array.isArray(registration.payments) ? registration.payments[0] : registration.payments;
  if (job.type === "pay_later_expired") {
    if (registration.status !== "expired" || cutoff > Date.now() || payment?.status === "paid") return null;
  } else {
    if (!registration.organizations?.is_active || registration.status !== "pending" || payment?.status !== "pending" || cutoff <= Date.now() ||
      ["closed", "completed"].includes(registration.events.status)) return null;
    if (job.type === "pay_later_reminder_7d" || job.type === "pay_later_reminder_1d") {
      // A retry on a later day must not falsely say "tomorrow" or "in 7 days".
      const day = (time: number) => Math.floor((time + 8 * 60 * 60 * 1000) / 86400000);
      const daysRemaining = day(cutoff - 1) - day(Date.now());
      if (daysRemaining !== (job.type === "pay_later_reminder_7d" ? 7 : 1)) return null;
    }
  }
  return { type: job.type,
    participantName: typeof registration.custom_data?.full_name === "string" ? registration.custom_data.full_name : "",
    eventName: registration.events.name, organizationName: "", eventDate: registration.events.event_date ?? "",
    categoryLabel: registration.categories?.label, dueAt,
    amountCents: payment?.amount ?? registration.total_amount,
    processingFeesAdditional: payment?.checkout_provider_managed_fee === true,
    actionUrl: `${siteUrl}/${job.type.startsWith("pay_later_reminder") ? "pay" : "ticket"}/${registration.id}` };
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
      if (isPayLaterEmail(job.type)) {
        const input = await payLaterInput(job, db, siteUrl);
        if (!input) {
          skipped++;
        } else {
          const recipient = await db.auth.admin.getUserById(job.user_id);
          const user = recipient.data.user;
          if (recipient.error || !user?.email || !user.email_confirmed_at) throw new Error("confirmed_recipient_required");
          if (!input.participantName) input.participantName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "runner";
          const rendered = renderPayLaterEmail(input);
          const delivered = await sendEmail(user.email, rendered.subject, rendered.html, rendered.text, { idempotencyKey: `lifecycle/${job.id}` });
          if (!delivered.ok) throw new Error("email_transport_failed");
          sent++;
        }
      } else {
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
