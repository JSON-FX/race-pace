import { createClient } from "@/lib/supabase/server";

/**
 * Slug helpers live in `@/lib/org-slug` and are re-exported here so server
 * callers have one import site for everything about an organization. They are
 * in their own module because the New-organization dialog is a Client
 * Component: importing them from THIS file would drag `@/lib/supabase/server`
 * (and therefore `next/headers`) into the browser bundle and fail `next build`.
 */
export { normalizeSlug, isValidSlug } from "@/lib/org-slug";

export type CommissionTerms = {
  commission_type: string | null;
  commission_rate: number | null;
  commission_flat_cents: number | null;
};

/**
 * The Rate cell. A flat fee and a percentage are not the same kind of number
 * and must never share a format — "75" in a column of "10.0%" reads as 75%.
 *
 * ₱0 flat is called out rather than rendered as a tidy "₱0": it is an
 * organization the platform earns nothing from. `org-provision` refuses to
 * create one, but rows predating this task (and any set by hand) can still be
 * in that state, so the list has to be able to say so.
 */
export function describeCommission(terms: CommissionTerms): { label: string; zero: boolean } {
  if (terms.commission_type === "fixed") {
    const cents = terms.commission_flat_cents ?? 0;
    return { label: `₱${(cents / 100).toLocaleString()} flat`, zero: cents <= 0 };
  }
  const rate = terms.commission_rate ?? 0;
  return { label: `${(rate * 100).toFixed(1)}%`, zero: rate <= 0 };
}

export type OrgListRow = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  eventCount: number;
  regCount: number;
  grossRevenue: number;
  platformFee: number;
  netToOrg: number;
} & CommissionTerms;

export type PlatformKpis = {
  orgCount: number;
  activeCount: number;
  gmvCents: number;
  commissionCents: number;
  /** Null when `payout_statements` could not be read at all — rendered as "—"
   *  rather than as ₱0, which would claim nothing is owed. */
  owedCents: number | null;
  openStatements: number;
};

/** PostgREST returns `bigint` aggregates as JSON numbers, but a `null` gets
 *  through whenever an outer join found no rows. */
const num = (v: unknown): number => Number(v ?? 0);

/**
 * Every organization on the platform, with its money totals.
 *
 * Super-admin only by construction, though not by enforcement here: the caller
 * page guards on `roles.isSuperAdmin`, and the database enforces it
 * independently — `admin_org_totals_v` is `security_invoker`, so its rows are
 * whatever `registrations_read_org_admin` lets this caller see, which for
 * anyone but a super admin is their own org alone.
 *
 * KNOWN LIMITATION: `orgs_read_active` restricts `organizations` SELECT to
 * `is_active = true` for every authenticated caller, super admin included. So
 * the Status column can only ever read "Active" today. Deactivation is out of
 * scope for this task (design §6), and fixing the read would need a migration
 * this task is not allowed to write — but the column is kept because the
 * moment that policy is widened it starts telling the truth, and a list of
 * organizations that cannot express "this one is switched off" is worse than
 * one whose column is currently uniform.
 */
export async function getPlatformOrganizations(): Promise<{ rows: OrgListRow[]; kpis: PlatformKpis }> {
  const supabase = await createClient();

  const [orgsRes, totalsRes, eventsRes, statementsRes] = await Promise.all([
    supabase
      .from("organizations")
      .select("id,name,slug,is_active,commission_type,commission_rate,commission_flat_cents")
      .order("name"),
    supabase
      .from("admin_org_totals_v")
      .select("org_id,reg_count,gross_revenue,platform_fee,net_to_org"),
    // One column, tallied in memory rather than N head-count round trips. The
    // platform has tens of organizations and hundreds of events; when that stops
    // being true this wants its own aggregate view, not a bigger page size.
    supabase.from("events").select("org_id"),
    // Open statements only — this is money not yet transferred. See the KPI's
    // caption on the page for the nuance a bare figure would hide.
    supabase.from("payout_statements").select("net_owed_cents").eq("status", "open"),
  ]);

  if (orgsRes.error) throw orgsRes.error;
  if (totalsRes.error) throw totalsRes.error;

  const totals = new Map(
    (totalsRes.data ?? []).map((t) => [t.org_id as string, t]),
  );

  // A failed events read degrades one column to 0 rather than taking the page
  // down: the money figures are the reason this page exists.
  const eventCounts = new Map<string, number>();
  for (const e of eventsRes.data ?? []) {
    const id = (e as { org_id: string | null }).org_id;
    if (id) eventCounts.set(id, (eventCounts.get(id) ?? 0) + 1);
  }

  const rows: OrgListRow[] = (orgsRes.data ?? []).map((o) => {
    const t = totals.get(o.id);
    return {
      id: o.id,
      name: o.name,
      slug: o.slug,
      isActive: o.is_active,
      commission_type: o.commission_type,
      commission_rate: o.commission_rate,
      commission_flat_cents: o.commission_flat_cents,
      eventCount: eventCounts.get(o.id) ?? 0,
      // An org with no registrations has no row in the view at all — a missing
      // row means zero, not missing data.
      regCount: num(t?.reg_count),
      grossRevenue: num(t?.gross_revenue),
      platformFee: num(t?.platform_fee),
      netToOrg: num(t?.net_to_org),
    };
  });

  const statements = statementsRes.error ? null : statementsRes.data ?? [];

  return {
    rows,
    kpis: {
      orgCount: rows.length,
      activeCount: rows.filter((r) => r.isActive).length,
      // Platform-wide, so summed across every org rather than read off any one
      // of them — this is the number the scope band exists to distinguish from
      // the org-scoped one on Dashboard.
      gmvCents: rows.reduce((s, r) => s + r.grossRevenue, 0),
      commissionCents: rows.reduce((s, r) => s + r.platformFee, 0),
      owedCents: statements === null
        ? null
        : statements.reduce((s, r) => s + num((r as { net_owed_cents: unknown }).net_owed_cents), 0),
      openStatements: statements?.length ?? 0,
    },
  };
}
