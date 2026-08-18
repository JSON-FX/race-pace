// Super-admin only. Creates an organization AND invites its first admin.
//
// Both halves are required: an org row nobody can log into is inert, and /team
// is unreachable until someone can. The invite uses the same
// auth.admin.inviteUserByEmail call as org-members/index.ts:87, which sends
// through whatever SMTP Supabase is configured with — so the email path starts
// working the moment SMTP is set up, with no code change. Until then the action
// link is returned for manual delivery.
//
// Service role, so RLS is bypassed and the super_admin check below IS the
// authorization boundary — exactly the shape org-members uses.
import { serviceClient } from "../_shared/supabase.ts";
import { preflight, corsHeaders } from "../_shared/cors.ts";
import {
  validateRename,
  isDeleteBlocked,
  orgStoragePrefixes,
  mapDeleteRpcError,
  type SettledCounts,
} from "../_shared/orgAdmin.ts";

type Db = ReturnType<typeof serviceClient>;

/** Lowercase-kebab, ASCII only. Diacritics are folded rather than dropped, so
 *  "Peñafrancia Runners" becomes "penafrancia-runners" and not
 *  "pe-afrancia-runners". Kept byte-identical to apps/web's normalizeSlug
 *  (lib/queries/organizations.ts) — the dialog normalises for display, this
 *  normalises for storage, and the two must never disagree about what the
 *  operator is reserving. */
export function normalizeSlug(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type CreateInput = {
  name: string;
  slug: string;
  admin_email: string;
  commission_type: string;
  commission_rate: number | null;
  commission_flat_cents: number;
  refund_policy: string;
  refund_fee_cents: number;
};

/**
 * Returns an error code, or null when the input is provisionable.
 *
 * The commercial terms are required INPUTS here, not defaults. `organizations`
 * defaults commission_type to 'fixed' and commission_flat_cents to 0, so a
 * create-then-forget path would silently produce an organization Race Pace
 * earns nothing from — and nobody would notice until the first payout was
 * computed against a zero fee. A zero percentage is the same organization by a
 * different route, so it is refused on the same grounds.
 *
 * A flat_fee refund policy with a ₱0 retention is likewise refused: it is
 * indistinguishable from a 'full' refund, and an operator who meant "full"
 * should say so rather than encode it as a degenerate flat fee (design
 * 2026-08-06 §9.6).
 */
export function validateCreateInput(input: CreateInput): string | null {
  if (!input.name.trim()) return "name_required";
  if (!SLUG_RE.test(input.slug)) return "bad_slug";
  if (!EMAIL_RE.test(input.admin_email)) return "bad_email";

  if (input.commission_type === "fixed") {
    if (!Number.isInteger(input.commission_flat_cents)) return "bad_commission";
    if (input.commission_flat_cents <= 0) return "zero_commission";
  } else if (input.commission_type === "percent") {
    const rate = input.commission_rate;
    if (typeof rate !== "number" || !Number.isFinite(rate)) return "bad_commission";
    // Stored as a fraction (0.10 = 10%). The UI converts; the DB must never see
    // 10 meaning 10%, which would be a 1000% fee.
    if (rate <= 0 || rate > 1) return "zero_commission";
  } else {
    return "bad_commission";
  }

  if (!["full", "none", "flat_fee"].includes(input.refund_policy)) return "bad_refund_policy";
  if (!Number.isInteger(input.refund_fee_cents) || input.refund_fee_cents < 0) return "bad_refund_fee";
  if (input.refund_policy === "flat_fee" && input.refund_fee_cents <= 0) return "zero_retention";

  return null;
}

/** Find an existing auth user id by email by paginating the admin user list.
 *  Same helper as org-members/index.ts — an operator provisioning a second org
 *  for someone who already runs one must reuse their account, not fail. */
async function findUserIdByEmail(db: Db, email: string): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (hit) return hit.id;
    if (users.length < 200) break; // reached the last page
  }
  return null;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const cors = corsHeaders(req.headers.get("Origin"));
  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors } });

  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!jwt) return json({ error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = (body.action as string | undefined) ?? "create";

    const db = serviceClient();
    const { data: userRes, error: userErr } = await db.auth.getUser(jwt);
    if (userErr || !userRes.user) return json({ error: "unauthorized" }, 401);

    // Authorization boundary. Service role bypasses RLS, so nothing else stops
    // an org admin from minting organizations for themselves. Provisioning is
    // strictly a platform operation.
    const { data: callerRoles } = await db.from("user_roles").select("role").eq("user_id", userRes.user.id);
    if (!(callerRoles ?? []).some((r) => r.role === "super_admin")) return json({ error: "forbidden" }, 403);

    // Availability is checked with the SERVICE role deliberately. The
    // `orgs_read_active` RLS policy hides deactivated organizations from every
    // authenticated caller, but the unique constraint does not care whether a
    // row is active — a browser-side check would report a slug free and then
    // the insert would fail with a duplicate key the operator cannot explain.
    if (action === "check_slug") {
      const slug = normalizeSlug(String(body.slug ?? ""));
      if (!SLUG_RE.test(slug)) return json({ ok: true, slug, available: false, reason: "bad_slug" });
      const { data: hit, error } = await db.from("organizations").select("id").eq("slug", slug).maybeSingle();
      if (error) return json({ error: "server_error" }, 500);
      return json({ ok: true, slug, available: !hit });
    }

    // Every branch below inherits the super_admin gate above. Service role on
    // purpose: `name` happens to be in the column grant today and `is_active`
    // deliberately is not, and a rename path that depended on that distinction
    // would break the moment the grant is tightened again.
    const ORG_COLUMNS =
      "id,name,slug,commission_type,commission_rate,commission_flat_cents,refund_policy,refund_fee_cents,is_active,created_at";

    if (action === "update") {
      const orgId = String(body.org_id ?? "");
      const name = String(body.name ?? "");
      if (!orgId) return json({ error: "bad_request" }, 400);
      const invalid = validateRename(name);
      if (invalid) return json({ error: invalid }, 400);

      const { data: org, error } = await db
        .from("organizations")
        .update({ name: name.trim() })
        .eq("id", orgId)
        .select(ORG_COLUMNS)
        .maybeSingle();
      if (error) return json({ error: "server_error" }, 500);
      if (!org) return json({ error: "not_found" }, 404);
      return json({ ok: true, org });
    }

    if (action === "set_active") {
      const orgId = String(body.org_id ?? "");
      if (!orgId || typeof body.is_active !== "boolean") return json({ error: "bad_request" }, 400);

      const { data: org, error } = await db
        .from("organizations")
        .update({ is_active: body.is_active })
        .eq("id", orgId)
        .select(ORG_COLUMNS)
        .maybeSingle();
      if (error) return json({ error: "server_error" }, 500);
      if (!org) return json({ error: "not_found" }, 404);
      return json({ ok: true, org });
    }

    /** Counts for the confirm dialog AND the guard decision. The browser
     *  renders the reason; it never decides it — `delete` re-runs the same
     *  check server-side before touching anything. */
    async function orgCounts(orgId: string) {
      const head = async (table: string) => {
        const { count } = await db.from(table).select("id", { count: "exact", head: true }).eq("org_id", orgId);
        return count ?? 0;
      };
      const settled = async (status: string) => {
        const { count } = await db.from("payments")
          .select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", status);
        return count ?? 0;
      };
      const [events, categories, registrations, payments, checkins, members, payout_statements] =
        await Promise.all([
          head("events"), head("categories"), head("registrations"),
          head("payments"), head("checkins"), head("user_roles"), head("payout_statements"),
        ]);
      const blocking: SettledCounts = {
        paid: await settled("paid"),
        refunded: await settled("refunded"),
        partially_refunded: await settled("partially_refunded"),
      };
      return {
        counts: { events, categories, registrations, payments, checkins, members, payout_statements },
        blocking,
      };
    }

    if (action === "delete_preview") {
      const orgId = String(body.org_id ?? "");
      if (!orgId) return json({ error: "bad_request" }, 400);
      const { data: org } = await db.from("organizations").select("id").eq("id", orgId).maybeSingle();
      if (!org) return json({ error: "not_found" }, 404);

      const { counts, blocking } = await orgCounts(orgId);
      const blocked = isDeleteBlocked(blocking);
      return json({ ok: true, counts, blocked, blocking: blocked ? blocking : null });
    }

    if (action === "delete") {
      const orgId = String(body.org_id ?? "");
      const slug = String(body.slug ?? "");
      if (!orgId || !slug) return json({ error: "bad_request" }, 400);

      const { data: org } = await db
        .from("organizations").select("id,slug,name").eq("id", orgId).maybeSingle();
      if (!org) return json({ error: "not_found" }, 404);

      // Not the UI's confirmation — the dialog has its own. This is the guard
      // against a mis-targeted call reaching the function at all, which is the
      // one mistake here that has no undo.
      if (org.slug !== slug) return json({ error: "slug_mismatch" }, 400);

      // The preview is advisory. THIS is the gate the request goes through on
      // this side — and delete_organization_tx re-checks it again itself,
      // under row locks, which is what actually closes the race a caller that
      // skips the preview could otherwise hit.
      const { blocking } = await orgCounts(orgId);
      if (isDeleteBlocked(blocking)) return json({ error: "org_has_payments", blocking }, 409);

      const { data: deleted, error: rpcErr } = await db.rpc("delete_organization_tx", { p_org_id: orgId });
      if (rpcErr) {
        const { code, status } = mapDeleteRpcError(rpcErr.message);
        return json({ error: code }, status);
      }

      // AFTER the transaction commits, and deliberately not inside it: Postgres
      // cannot delete an S3 object, and a storage failure must not roll back a
      // delete whose rows are already gone. Orphaned files are reported, not
      // fatal.
      //
      // This is also the path that WORKS — the `supabase storage rm` CLI is a
      // silent no-op against projects on the new sb_secret_ API keys, but this
      // function holds a real service key.
      let storageOk = true;
      for (const { bucket, prefix } of orgStoragePrefixes(orgId)) {
        const { data: files, error: listErr } = await db.storage.from(bucket).list(prefix, { limit: 1000 });
        if (listErr) { storageOk = false; continue; }
        const paths = (files ?? []).map((f) => `${prefix}/${f.name}`);
        if (paths.length === 0) continue;
        const { error: rmErr } = await db.storage.from(bucket).remove(paths);
        if (rmErr) storageOk = false;
      }
      if (!storageOk) console.error(`[org-provision] storage cleanup incomplete for org ${orgId}`);

      return json({
        ok: true, deleted, name: org.name,
        storage_cleanup: storageOk ? "complete" : "partial",
      });
    }

    if (action !== "create") return json({ error: "unknown_action" }, 400);

    const input: CreateInput = {
      name: String(body.name ?? "").trim(),
      slug: normalizeSlug(String(body.slug ?? body.name ?? "")),
      admin_email: String(body.admin_email ?? "").trim().toLowerCase(),
      commission_type: String(body.commission_type ?? ""),
      commission_rate: body.commission_rate === null || body.commission_rate === undefined
        ? null
        : Number(body.commission_rate),
      commission_flat_cents: Number(body.commission_flat_cents ?? 0),
      refund_policy: String(body.refund_policy ?? ""),
      refund_fee_cents: Number(body.refund_fee_cents ?? 0),
    };

    const invalid = validateCreateInput(input);
    if (invalid) return json({ error: invalid }, 400);

    // ---- Step 1: the organization row ------------------------------------
    //
    // commission_rate is written on BOTH branches. `organizations.commission_rate`
    // is `not null default 0.10`, and computeFee (_shared/fee.ts) falls back to
    // 0.10 whenever the type is not 'fixed' — so leaving a stale rate behind a
    // flat fee is a live 10% waiting for someone to flip the type back.
    const { data: org, error: orgErr } = await db
      .from("organizations")
      .insert({
        name: input.name,
        slug: input.slug,
        commission_type: input.commission_type,
        commission_rate: input.commission_type === "percent" ? input.commission_rate : 0,
        commission_flat_cents: input.commission_type === "fixed" ? input.commission_flat_cents : 0,
        refund_policy: input.refund_policy,
        refund_fee_cents: input.refund_policy === "flat_fee" ? input.refund_fee_cents : 0,
      })
      .select("id,name,slug,commission_type,commission_rate,commission_flat_cents,refund_policy,refund_fee_cents,is_active,created_at")
      .single();

    // 23505: the unique slug constraint. Reachable even after a green on-blur
    // check — two operators can race — so it is translated, not swallowed.
    if (orgErr) return json({ error: orgErr.code === "23505" ? "slug_taken" : "server_error" }, orgErr.code === "23505" ? 409 : 500);
    if (!org) return json({ error: "server_error" }, 500);

    // ---- Steps 2 & 3: the first admin ------------------------------------
    //
    // CLEANUP CHOICE, and why this one:
    //
    // If anything after the org insert fails, the ORG ROW IS DELETED. A
    // half-provisioned org — a row nobody holds a role on — is invisible to
    // every /team path and would have to be found and cleaned up by hand,
    // while its slug stays permanently taken. Nothing references the org yet
    // (no events, no registrations, no payments), so the delete is safe.
    //
    // The AUTH USER is deliberately NOT deleted on rollback. They may be a
    // pre-existing account that merely got matched by email, in which case
    // deleting them would destroy an unrelated person's login. Even a freshly
    // invited account is harmless on its own: it holds no role, and a retry
    // finds it again by email and reuses it. So the auth half is idempotent
    // rather than transactional, and the org half is compensated.
    const rollback = async () => { await db.from("organizations").delete().eq("id", org.id); };

    let userId: string | null;
    try {
      userId = await findUserIdByEmail(db, input.admin_email);
    } catch {
      await rollback();
      return json({ error: "server_error" }, 500);
    }

    let invited = false;
    if (!userId) {
      const { data: inv, error: invErr } = await db.auth.admin.inviteUserByEmail(input.admin_email);
      if (invErr || !inv?.user) {
        await rollback();
        return json({ error: "invite_failed" }, 502);
      }
      userId = inv.user.id;
      invited = true;
    }

    const { error: roleErr } = await db.from("user_roles").insert({
      org_id: org.id, user_id: userId, role: "admin",
    });
    if (roleErr) {
      await rollback();
      return json({ error: "role_failed" }, 500);
    }

    // The action link exists so provisioning is usable BEFORE SMTP is
    // configured — without it, a successful create leaves the operator with no
    // way to hand the account over.
    //
    // 'magiclink', not 'invite': the account exists by the time we get here
    // (inviteUserByEmail created it, or it already did), and generateLink's
    // 'invite' type is for an address that has no user yet. A magic link signs
    // the same account in, which is what manual delivery needs.
    //
    // Best-effort: the org and its admin role are already committed, so a link
    // failure returns ok with invite_link: null rather than rolling back a
    // correctly provisioned organization over a convenience field.
    const { data: link } = await db.auth.admin.generateLink({
      type: "magiclink", email: input.admin_email,
    });
    const inviteLink: string | null = link?.properties?.action_link ?? null;

    return json({ ok: true, org, invited, invite_link: inviteLink });
  } catch (_e) {
    return json({ error: "server_error" }, 500);
  }
});
