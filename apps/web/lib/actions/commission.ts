"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles } from "@/lib/queries/roles";
import { hasCapability } from "@/lib/capabilities";
import { percentToRate } from "@/lib/commission-terms";

export type TermsState = { error?: string; success?: string };

const GENERIC_ERROR = "Couldn't save those terms. Please try again.";

/**
 * Commercial terms are a PLATFORM capability, not an org one.
 *
 * This is the same shape of check as `assertCanEditOrg` in
 * `lib/actions/settings.ts`, and the same warning applies: it is not
 * defense-in-depth, it is the authorization boundary the UI relies on. The
 * database enforces the rule independently — `organizations_super_admin_terms`
 * (20260807090600_page_support_rpcs.sql) is `using (auth_is_super_admin())` —
 * but an org admin must never even be offered the write, and an RLS-blocked
 * UPDATE reports zero rows rather than an error, which would otherwise read as
 * a silent success.
 */
function assertSuperAdmin(roles: Awaited<ReturnType<typeof getMyRoles>>): string | null {
  return roles?.isSuperAdmin ? null : "Only a super admin can change commercial terms.";
}

/** Whole pesos (what the operator types, next to a ₱) -> integer centavos
 *  (what the column stores). Rejects anything that isn't a non-negative
 *  number — an empty box, a stray letter, a negative amount. */
function parsePesos(raw: string): { cents: number } | { error: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { error: "Enter an amount in pesos." };
  const pesos = Number(trimmed);
  if (!Number.isFinite(pesos)) return { error: "Enter an amount in pesos." };
  if (pesos < 0) return { error: "An amount cannot be negative." };
  return { cents: Math.round(pesos * 100) };
}

/**
 * Save one organization's FEE terms.
 *
 * Deliberately does not touch the refund columns even though they sit on the
 * same row: the two tables are edited independently, and writing all five
 * columns from whichever form submitted last would let a stale fee input
 * silently revert a refund policy saved seconds earlier.
 *
 * Nothing here is retroactive, by design — `_shared/confirm.ts` freezes the fee
 * onto each payment at confirmation, so this only changes what the NEXT
 * registration is charged. The page says so in amber above the button.
 */
export async function saveFeeTermsAction(_prev: TermsState, formData: FormData): Promise<TermsState> {
  const orgId = String(formData.get("orgId") ?? "");
  const type = String(formData.get("commission_type") ?? "");
  if (!orgId) return { error: "Missing organization." };
  if (type !== "percent" && type !== "fixed") return { error: "Choose a percentage or a flat fee." };

  const roles = await getMyRoles();
  const denied = assertSuperAdmin(roles);
  if (denied) return { error: denied };

  // BOTH amounts are written on every save, not just the active one.
  //
  // `commission_rate` is `not null default 0.10`, and `computeFee` falls back to
  // 0.10 for any non-'fixed' type — so an org moved to a flat fee while carrying
  // an untouched rate has a live 10% sitting behind the toggle, waiting for
  // whoever flips it back. Same in reverse for a stale flat amount. Persisting
  // exactly what the row displays in either mode means the inactive half is
  // never a number nobody chose.
  const raw = String(formData.get("commission_percent") ?? "").trim();
  const percent = Number(raw);
  if (raw === "" || !Number.isFinite(percent)) return { error: "Enter a percentage." };
  if (percent < 0 || percent > 100) return { error: "A percentage must be between 0 and 100." };
  // `commission_rate` is numeric(5,4) — four decimal places on the FRACTION, so
  // two on the percentage. Rejected rather than silently rounded by Postgres, so
  // the operator sees the number they will actually be charging.
  if (Math.round(percent * 100) !== percent * 100) {
    return { error: "Use at most two decimal places." };
  }
  const flat = parsePesos(String(formData.get("commission_flat_pesos") ?? ""));
  if ("error" in flat) return { error: flat.error };

  const patch: Record<string, unknown> = {
    commission_type: type,
    // The conversion the whole page is careful about: the column is a fraction.
    // A 10 arriving here unconverted is a 1000% fee.
    commission_rate: percentToRate(percent),
    commission_flat_cents: flat.cents,
  };

  return write(orgId, patch, "Fee terms saved. Entries paid from now on use them.");
}

/** Save one organization's REFUND policy. Same split-write reasoning as
 *  `saveFeeTermsAction`. */
export async function saveRefundTermsAction(_prev: TermsState, formData: FormData): Promise<TermsState> {
  const orgId = String(formData.get("orgId") ?? "");
  const policy = String(formData.get("refund_policy") ?? "");
  if (!orgId) return { error: "Missing organization." };
  if (policy !== "full" && policy !== "none" && policy !== "flat_fee") {
    return { error: "Choose a refund policy." };
  }

  const roles = await getMyRoles();
  const denied = assertSuperAdmin(roles);
  if (denied) return { error: denied };

  // Written on every save for the same reason the fee amounts are: a retention
  // left behind from an earlier `flat_fee` period would come back to life,
  // unreviewed, the moment someone selects that policy again.
  const parsed = parsePesos(String(formData.get("refund_fee_pesos") ?? ""));
  if ("error" in parsed) return { error: parsed.error };

  return write(orgId, { refund_policy: policy, refund_fee_cents: parsed.cents }, "Refund policy saved.");
}

/**
 * Move one organization between absorbing the processor's cut and passing it on
 * to the runner.
 *
 * A Server Action is a PUBLIC ENDPOINT. The Commission page is super-admin-only
 * and the control is not rendered anywhere else, but neither fact reaches this
 * function — anyone with a session can POST to it. So the capability is
 * re-checked here, and again by the database underneath: 20260811097000 grants
 * the column to `authenticated` and then guards it with a BEFORE UPDATE trigger
 * that raises 42501 for a non-super-admin, because `organizations`' other UPDATE
 * policy (`organizations_update_branding_org_admin`, `using
 * auth_can_admin_org(id)`) is column-agnostic and would otherwise have let an
 * org admin put their OWN organization on pass_on.
 *
 * `manage_platform` rather than `roles?.isSuperAdmin`, unlike this file's two
 * older actions: it is the same set (capabilitiesFor grants all four to a super
 * admin and manage_platform to nobody else) said in the vocabulary the pages
 * gate on, so the action and the page it is reached from cannot drift.
 */
export async function setFeeMode(orgId: string, mode: "absorb" | "pass_on"): Promise<TermsState> {
  if (!orgId) return { error: "Missing organization." };
  if (mode !== "absorb" && mode !== "pass_on") return { error: "Unknown fee mode." };

  const roles = await getMyRoles();
  if (!hasCapability(roles?.capabilities ?? [], "manage_platform")) {
    return { error: "Only a super admin can change who pays processing fees." };
  }

  return write(
    orgId,
    { fee_mode: mode },
    mode === "pass_on"
      ? "Runners now cover processing. This organizer receives the full entry price."
      : "This organizer now absorbs processing. Runners pay the sticker price.",
  );
}

async function write(orgId: string, patch: Record<string, unknown>, success: string): Promise<TermsState> {
  const supabase = await createClient();
  // `.select("id")` is load-bearing — see the same call in lib/actions/settings.ts.
  // An UPDATE blocked by RLS (or missing from the column-level grant, which is
  // exactly how the branding editor broke) affects zero rows WITHOUT raising, so
  // without asking for the row back a blocked write is indistinguishable from a
  // real one and this action would report success for a no-op.
  const { data, error } = await supabase.from("organizations").update(patch).eq("id", orgId).select("id");
  if (error) {
    console.error("[commission] terms update failed", { orgId, patch, error });
    return { error: GENERIC_ERROR };
  }
  if (!data || data.length === 0) {
    console.error("[commission] terms update affected zero rows", { orgId, patch });
    return { error: GENERIC_ERROR };
  }

  revalidatePath("/commission");
  return { success };
}
