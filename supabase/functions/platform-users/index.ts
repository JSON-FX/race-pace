import type { User } from "@supabase/supabase-js";
import { corsHeaders, preflight } from "../_shared/cors.ts";
import {
  isCurrentRegistration,
  isSuspended,
  latestByDate,
  passportDisplayName,
  providerFor,
  userDisplayName,
} from "../_shared/platformUsers.ts";
import { serviceClient } from "../_shared/supabase.ts";

type Db = ReturnType<typeof serviceClient>;
type UnknownRow = Record<string, unknown>;

type PaymentSnapshot = {
  method: string;
  amountCents: number;
  paidAt: string;
  eventName: string;
};

type RegistrationSnapshot = {
  id: string;
  eventName: string;
  eventDate: string | null;
  eventStatus: string | null;
  category: string;
  status: string;
  createdAt: string;
  amountCents: number;
  payment: PaymentSnapshot | null;
};

type PassportSnapshot = {
  id: string;
  name: string;
  avatarUrl: string | null;
  relationship: "own" | "managed";
  claimed: boolean;
  registrations: RegistrationSnapshot[];
  currentRegistrations: RegistrationSnapshot[];
  latestPayment: PaymentSnapshot | null;
};

type PlatformUserSnapshot = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  provider: "google" | "email" | "other";
  createdAt: string;
  lastSignInAt: string | null;
  status: "active" | "suspended";
  protectedAccount: boolean;
  registrations: RegistrationSnapshot[];
  currentRegistrations: RegistrationSnapshot[];
  latestPayment: PaymentSnapshot | null;
  passports: PassportSnapshot[];
};

const BAN_DURATION = "876000h";
const CHUNK_SIZE = 100;

function chunks<T>(values: T[], size = CHUNK_SIZE): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function one(value: unknown): UnknownRow | null {
  if (Array.isArray(value)) return (value[0] as UnknownRow | undefined) ?? null;
  return value && typeof value === "object" ? value as UnknownRow : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function listAuthUsers(db: Db): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const batch = data?.users ?? [];
    users.push(...batch);
    if (batch.length < 200) return users;
  }
  throw new Error("user_limit_exceeded");
}

async function readRows(db: Db, userIds: string[]) {
  const profiles: UnknownRow[] = [];
  const roles: UnknownRow[] = [];
  const managers: UnknownRow[] = [];
  const ownPassports: UnknownRow[] = [];
  const registrations: UnknownRow[] = [];
  const groupAttempts: UnknownRow[] = [];

  for (const ids of chunks(userIds)) {
    const [profileRes, roleRes, managerRes, passportRes, registrationRes] = await Promise.all([
      db.from("profiles").select("id,full_name,avatar_url").in("id", ids),
      db.from("user_roles").select("user_id,role").in("user_id", ids),
      db.from("passport_managers").select("user_id,passport_id").in("user_id", ids),
      db.from("runner_passports")
        .select("id,claimed_user_id,created_by_user_id,first_name,last_name,legacy_full_name,created_at")
        .in("claimed_user_id", ids),
      db.from("registrations")
        .select("id,user_id,booked_by_user_id,participant_passport_id,booking_order_id,status,total_amount,created_at,events(name,event_date,status),categories(label),payments(method,amount,status,paid_at,created_at)")
        .or(`booked_by_user_id.in.(${ids.join(",")}),user_id.in.(${ids.join(",")})`),
    ]);
    const failed = [profileRes, roleRes, managerRes, passportRes, registrationRes].find((result) => result.error);
    if (failed?.error) throw failed.error;
    profiles.push(...(profileRes.data ?? []) as UnknownRow[]);
    roles.push(...(roleRes.data ?? []) as UnknownRow[]);
    managers.push(...(managerRes.data ?? []) as UnknownRow[]);
    ownPassports.push(...(passportRes.data ?? []) as UnknownRow[]);
    registrations.push(...(registrationRes.data ?? []) as UnknownRow[]);
  }

  const managedIds = [...new Set(managers.map((manager) => str(manager.passport_id)).filter((id): id is string => Boolean(id)))];
  const managedPassports: UnknownRow[] = [];
  for (const ids of chunks(managedIds)) {
    const [passportRes, registrationRes] = await Promise.all([
      db.from("runner_passports")
        .select("id,claimed_user_id,created_by_user_id,first_name,last_name,legacy_full_name,created_at")
        .in("id", ids),
      db.from("registrations")
        .select("id,user_id,booked_by_user_id,participant_passport_id,booking_order_id,status,total_amount,created_at,events(name,event_date,status),categories(label),payments(method,amount,status,paid_at,created_at)")
        .in("participant_passport_id", ids),
    ]);
    if (passportRes.error) throw passportRes.error;
    if (registrationRes.error) throw registrationRes.error;
    managedPassports.push(...(passportRes.data ?? []) as UnknownRow[]);
    registrations.push(...(registrationRes.data ?? []) as UnknownRow[]);
  }

  const dedupedRegistrations = [...new Map(registrations.map((registration) => [String(registration.id), registration])).values()];
  for (const ids of chunks(userIds)) {
    const { data, error } = await db.from("booking_payment_attempts")
      .select("id,booking_order_id,booked_by_user_id,method,status,gross_cents,created_at,booking_payment_captures(state,created_at)")
      .in("booked_by_user_id", ids)
      .eq("status", "paid");
    if (error) throw error;
    groupAttempts.push(...(data ?? []) as UnknownRow[]);
  }
  const orderIds = [...new Set(dedupedRegistrations.map((registration) => str(registration.booking_order_id)).filter((id): id is string => Boolean(id)))];
  for (const ids of chunks(orderIds)) {
    const { data, error } = await db.from("booking_payment_attempts")
      .select("id,booking_order_id,booked_by_user_id,method,status,gross_cents,created_at,booking_payment_captures(state,created_at)")
      .in("booking_order_id", ids)
      .eq("status", "paid");
    if (error) throw error;
    groupAttempts.push(...(data ?? []) as UnknownRow[]);
  }

  const dedupedAttempts = [...new Map(groupAttempts.map((attempt) => [String(attempt.id), attempt])).values()];
  return { profiles, roles, managers, passports: [...ownPassports, ...managedPassports], registrations: dedupedRegistrations, groupAttempts: dedupedAttempts };
}

function buildSnapshots(users: User[], rows: Awaited<ReturnType<typeof readRows>>): PlatformUserSnapshot[] {
  const profiles = new Map(rows.profiles.map((profile) => [String(profile.id), profile]));
  const protectedUsers = new Set(rows.roles.filter((role) => role.role === "super_admin").map((role) => String(role.user_id)));
  const passports = new Map<string, UnknownRow>();
  for (const passport of rows.passports) passports.set(String(passport.id), passport);

  const managersByUser = new Map<string, string[]>();
  for (const manager of rows.managers) {
    const userId = String(manager.user_id);
    managersByUser.set(userId, [...(managersByUser.get(userId) ?? []), String(manager.passport_id)]);
  }

  const registrationsByBooker = new Map<string, UnknownRow[]>();
  const registrationsByPassport = new Map<string, UnknownRow[]>();
  for (const registration of rows.registrations) {
    const userId = String(registration.booked_by_user_id ?? registration.user_id ?? "");
    if (userId) registrationsByBooker.set(userId, [...(registrationsByBooker.get(userId) ?? []), registration]);
    const passportId = str(registration.participant_passport_id);
    if (passportId) registrationsByPassport.set(passportId, [...(registrationsByPassport.get(passportId) ?? []), registration]);
  }

  const attemptsByOrder = new Map<string, UnknownRow>();
  for (const attempt of rows.groupAttempts) {
    const orderId = String(attempt.booking_order_id ?? "");
    const existing = attemptsByOrder.get(orderId);
    if (!existing || Date.parse(String(existing.created_at)) < Date.parse(String(attempt.created_at))) {
      attemptsByOrder.set(orderId, attempt);
    }
  }

  function registrationSnapshot(row: UnknownRow): RegistrationSnapshot {
    const event = one(row.events);
    const category = one(row.categories);
    const paymentRow = Array.isArray(row.payments) ? one(row.payments) : one(row.payments);
    const attempt = row.booking_order_id ? attemptsByOrder.get(String(row.booking_order_id)) : null;
    const capture = attempt ? one(attempt.booking_payment_captures) : null;
    const eventName = str(event?.name) ?? "Event unavailable";
    const payment = paymentRow && ["paid", "refunded"].includes(String(paymentRow.status))
      ? {
          method: str(paymentRow.method) ?? "paymongo",
          amountCents: num(paymentRow.amount),
          paidAt: str(paymentRow.paid_at) ?? str(paymentRow.created_at) ?? String(row.created_at),
          eventName,
        }
      : attempt
        ? {
            method: str(attempt.method) ?? "paymongo",
            amountCents: num(attempt.gross_cents),
            paidAt: str(capture?.created_at) ?? str(attempt.created_at) ?? String(row.created_at),
            eventName,
          }
        : null;
    return {
      id: String(row.id),
      eventName,
      eventDate: str(event?.event_date),
      eventStatus: str(event?.status),
      category: str(category?.label) ?? "Category unavailable",
      status: String(row.status ?? "unknown"),
      createdAt: String(row.created_at),
      amountCents: num(row.total_amount),
      payment,
    };
  }

  return users.map((user) => {
    const profile = profiles.get(user.id);
    const bookedRows = registrationsByBooker.get(user.id) ?? [];
    const ownPassport = [...passports.values()].find((passport) => passport.claimed_user_id === user.id);
    const passportIds = new Set<string>([
      ...(ownPassport ? [String(ownPassport.id)] : []),
      ...(managersByUser.get(user.id) ?? []),
    ]);
    const passportSnapshots = [...passportIds].map((passportId): PassportSnapshot | null => {
      const passport = passports.get(passportId);
      if (!passport) return null;
      const passportRegistrations = (registrationsByPassport.get(passportId) ?? [])
        .map(registrationSnapshot)
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
      const payments = passportRegistrations.flatMap((registration) => registration.payment ? [registration.payment] : []);
      const claimedUserId = str(passport.claimed_user_id);
      const claimedProfile = claimedUserId ? profiles.get(claimedUserId) : null;
      return {
        id: passportId,
        name: passportDisplayName(passport),
        avatarUrl: str(claimedProfile?.avatar_url),
        relationship: claimedUserId === user.id ? "own" : "managed",
        claimed: Boolean(claimedUserId),
        registrations: passportRegistrations,
        currentRegistrations: passportRegistrations.filter((registration) => isCurrentRegistration({ status: registration.status, eventDate: registration.eventDate, eventStatus: registration.eventStatus })),
        latestPayment: latestByDate(payments, (payment) => payment.paidAt),
      };
    }).filter((passport): passport is PassportSnapshot => passport !== null);

    const ownRegistrations = ownPassport
      ? (registrationsByPassport.get(String(ownPassport.id)) ?? []).map(registrationSnapshot)
      : bookedRows.filter((registration) => registration.user_id === user.id).map(registrationSnapshot);
    ownRegistrations.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
    const allPayments = bookedRows.map(registrationSnapshot).flatMap((registration) => registration.payment ? [registration.payment] : []);

    return {
      id: user.id,
      email: user.email ?? "No email address",
      name: userDisplayName(user, str(profile?.full_name)),
      avatarUrl: str(profile?.avatar_url),
      provider: providerFor(user),
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at ?? null,
      status: isSuspended(user) ? "suspended" : "active",
      protectedAccount: protectedUsers.has(user.id),
      registrations: ownRegistrations,
      currentRegistrations: ownRegistrations.filter((registration) => isCurrentRegistration({ status: registration.status, eventDate: registration.eventDate, eventStatus: registration.eventStatus })),
      latestPayment: latestByDate(allPayments, (payment) => payment.paidAt),
      passports: passportSnapshots.sort((left, right) => left.relationship === "own" ? -1 : right.relationship === "own" ? 1 : left.name.localeCompare(right.name)),
    };
  }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

async function requireSuperAdmin(req: Request, db: Db): Promise<{ userId: string } | Response> {
  const token = req.headers.get("Authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
  const { data: roles, error: roleError } = await db.from("user_roles").select("role").eq("user_id", data.user.id);
  if (roleError) return new Response(JSON.stringify({ error: "authorization_unavailable" }), { status: 503 });
  if (!(roles ?? []).some((role) => role.role === "super_admin")) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }
  return { userId: data.user.id };
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const cors = corsHeaders(req.headers.get("Origin"));
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...cors },
  });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const db = serviceClient();
    const authorization = await requireSuperAdmin(req, db);
    if (authorization instanceof Response) {
      return new Response(authorization.body, {
        status: authorization.status,
        headers: { "content-type": "application/json", ...cors },
      });
    }
    const body = await req.json().catch(() => ({}));
    const action = typeof body.action === "string" ? body.action : "list";

    if (action === "list") {
      const users = await listAuthUsers(db);
      const rows = users.length ? await readRows(db, users.map((user) => user.id)) : {
        profiles: [], roles: [], managers: [], passports: [], registrations: [], groupAttempts: [],
      };
      return json({ users: buildSnapshots(users, rows), generatedAt: new Date().toISOString() });
    }

    if (!["suspend", "restore"].includes(action)) return json({ error: "invalid_action" }, 400);
    const targetId = typeof body.user_id === "string" ? body.user_id : "";
    if (!targetId) return json({ error: "user_required" }, 400);
    if (targetId === authorization.userId) return json({ error: "self_action_forbidden" }, 409);

    const [{ data: target, error: targetError }, { data: targetRoles, error: roleError }] = await Promise.all([
      db.auth.admin.getUserById(targetId),
      db.from("user_roles").select("role").eq("user_id", targetId),
    ]);
    if (targetError || !target.user) return json({ error: "user_not_found" }, 404);
    if (roleError) return json({ error: "authorization_unavailable" }, 503);
    if ((targetRoles ?? []).some((role) => role.role === "super_admin")) {
      return json({ error: "protected_account" }, 409);
    }

    if (action === "suspend") {
      const { error } = await db.auth.admin.updateUserById(targetId, { ban_duration: BAN_DURATION });
      if (error) return json({ error: "suspension_failed" }, 503);
      const revoked = await db.rpc("platform_revoke_user_sessions", { p_user_id: targetId });
      if (revoked.error) {
        await db.auth.admin.updateUserById(targetId, { ban_duration: "none" });
        return json({ error: "session_revocation_failed" }, 503);
      }
      return json({ ok: true, user_id: targetId, status: "suspended", sessionsRevoked: revoked.data ?? 0 });
    }

    const { error } = await db.auth.admin.updateUserById(targetId, { ban_duration: "none" });
    if (error) return json({ error: "restore_failed" }, 503);
    return json({ ok: true, user_id: targetId, status: "active" });
  } catch (error) {
    console.error("[platform-users] request failed", { error: String(error) });
    return json({ error: "server_error" }, 500);
  }
});
