import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireOrgId, type MyRoles } from "./roles";

function roles(overrides: Partial<MyRoles>): MyRoles {
  return {
    role: "admin",
    orgId: "org-1",
    isSuperAdmin: false,
    isAdmin: true,
    isOrgAdmin: false,
    capabilities: [],
    ...overrides,
  };
}

describe("requireOrgId", () => {
  it("returns the org id when present", () => {
    expect(requireOrgId(roles({ orgId: "org-1" }))).toBe("org-1");
  });

  it("returns null for an admin with no org-scoped row (e.g. a bare super_admin)", () => {
    expect(requireOrgId(roles({ orgId: null, isSuperAdmin: true }))).toBeNull();
  });

  it("returns null when roles is null (unauthenticated)", () => {
    expect(requireOrgId(null)).toBeNull();
  });
});

describe("getMyRoles", () => {
  // The role model is additive/dual-role: a caller can hold an `admin` row
  // in one org and an `editor` row in another at the same time. orgId and
  // isOrgAdmin MUST describe the same org, or a write gated on `isOrgAdmin`
  // (e.g. Settings' assertCanEditOrg) can be satisfied for an org the
  // caller is only an editor of. This is a regression test for exactly
  // that bug: it must resolve to the admin org (X) with isOrgAdmin true,
  // and must NEVER report isOrgAdmin: true alongside orgId: "org-Y" (the
  // editor-only org), regardless of what order Postgres returns the rows in.
  //
  // Deliberately a PASSTHROUGH mock (does not sort `rows`): the admin-over-
  // editor guarantee comes from the explicit `find(admin) ?? find(editor)`
  // in roles.ts, not from `.order()` — see that file's comment. Feeding raw,
  // unsorted, adversarial row order here is what actually proves that.
  async function loadGetMyRoles(rows: { role: string; org_id: string }[]) {
    vi.resetModules();
    // Undo any @/lib/org-context override a previous test in this file left
    // behind (see loadGetMyRolesWithOrgContext below) — this helper wants the
    // real getOrgContext, not a leaked stub.
    vi.doUnmock("@/lib/org-context");
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
        from: () => ({
          select: () => ({
            order: () => ({
              order: async () => ({ data: rows, error: null }),
            }),
          }),
        }),
      }),
    }));
    return (await import("./roles")).getMyRoles;
  }

  // getOrgContext() only runs for a super admin, and this file's supabase
  // mock above supports two chained .order() calls while the real
  // getOrgContext makes only one — so under that mock, orgCtx?.activeOrgId is
  // always null, and `resolvedRow?.org_id ?? orgCtx?.activeOrgId` can't be
  // told apart from the wrong precedence `orgCtx?.activeOrgId ??
  // resolvedRow?.org_id`: `null ?? "org-E"` and `"org-E" ?? null` are the same
  // value. Mock @/lib/org-context directly with a DIFFERENT, distinguishable
  // org id so a test using this helper can actually tell which side won.
  async function loadGetMyRolesWithOrgContext(rows: { role: string; org_id: string }[]) {
    vi.resetModules();
    vi.doMock("@/lib/supabase/server", () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
        from: () => ({
          select: () => ({
            order: () => ({
              order: async () => ({ data: rows, error: null }),
            }),
          }),
        }),
      }),
    }));
    vi.doMock("@/lib/org-context", () => ({
      getOrgContext: async () => ({ activeOrgId: "org-FROM-CONTEXT" }),
    }));
    return (await import("./roles")).getMyRoles;
  }

  beforeEach(() => {
    vi.resetModules();
  });

  it("resolves to the admin org, not the editor org, when the editor row sorts first", async () => {
    const getMyRoles = await loadGetMyRoles([
      { role: "editor", org_id: "org-Y" },
      { role: "admin", org_id: "org-X" },
    ]);
    const result = await getMyRoles();
    expect(result?.orgId).toBe("org-X");
    expect(result?.isOrgAdmin).toBe(true);
    // The failure mode this guards: isOrgAdmin true paired with the
    // editor-only org.
    expect(result?.orgId).not.toBe("org-Y");
  });

  it("resolves to the admin org when the admin row sorts first too (order must not matter)", async () => {
    const getMyRoles = await loadGetMyRoles([
      { role: "admin", org_id: "org-X" },
      { role: "editor", org_id: "org-Y" },
    ]);
    const result = await getMyRoles();
    expect(result?.orgId).toBe("org-X");
    expect(result?.isOrgAdmin).toBe(true);
  });

  it("reports isOrgAdmin: false when resolved to an editor-only org", async () => {
    const getMyRoles = await loadGetMyRoles([{ role: "editor", org_id: "org-Y" }]);
    const result = await getMyRoles();
    expect(result?.orgId).toBe("org-Y");
    expect(result?.isOrgAdmin).toBe(false);
    expect(result?.isAdmin).toBe(true);
  });

  describe("known limitation: admin of two orgs at once", () => {
    // Not a security bug — both orgs are legitimately the caller's — and not
    // fixed here (an org switcher is a product decision outside this PR).
    // This documents the actual, narrower guarantee: given rows already
    // sorted by (role, org_id) — as the real `.order("role").order("org_id")`
    // query promises — the choice is STABLE (same org every call), not
    // "correct" in any deeper sense. Unlike the tests above, this mock
    // simulates the DB-level sort (ascending role, then org_id) because the
    // stability guarantee here comes from that ordering, not from JS logic —
    // roles.ts's `find()` still just takes whichever admin row is first in
    // whatever array it receives.
    async function loadGetMyRolesAsIfDbSorted(rows: { role: string; org_id: string }[]) {
      vi.resetModules();
      vi.doMock("@/lib/supabase/server", () => ({
        createClient: async () => ({
          auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
          from: () => ({
            select: () => ({
              order: () => ({
                order: async () => ({
                  data: [...rows].sort((a, b) => a.role.localeCompare(b.role) || a.org_id.localeCompare(b.org_id)),
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }));
      return (await import("./roles")).getMyRoles;
    }

    it("picks the alphabetically-first org_id, the same way regardless of input row order", async () => {
      const first = await loadGetMyRolesAsIfDbSorted([
        { role: "admin", org_id: "org-Z" },
        { role: "admin", org_id: "org-A" },
      ]);
      expect((await first())?.orgId).toBe("org-A");

      const second = await loadGetMyRolesAsIfDbSorted([
        { role: "admin", org_id: "org-A" },
        { role: "admin", org_id: "org-Z" },
      ]);
      expect((await second())?.orgId).toBe("org-A");
    });
  });

  it("resolves an org and check_in for a marshal-only account", async () => {
    const getMyRoles = await loadGetMyRoles([{ role: "marshal", org_id: "org-M" }]);
    const r = await getMyRoles();
    // Both halves matter: without the orgId the console renders NoOrgScope on
    // every page, which is the bug that made the shipped check-in station
    // unreachable rather than merely unlisted.
    expect(r!.orgId).toBe("org-M");
    expect(r!.capabilities).toEqual(["check_in"]);
  });

  it("keeps an editor out of manage_team", async () => {
    const getMyRoles = await loadGetMyRoles([{ role: "editor", org_id: "org-E" }]);
    const r = await getMyRoles();
    expect(r!.capabilities).toContain("manage_org");
    expect(r!.capabilities).not.toContain("manage_team");
  });

  // Honest scope: this proves orgId and capabilities agree with each other and
  // with the resolved row (admin-in-X wins, capabilities describe X). It does
  // NOT prove capabilities are computed from resolvedRow alone rather than a
  // union of capabilitiesFor(role) across all rows — with today's BY_ROLE,
  // admin's set is a strict superset of editor's (see the chain test in
  // capabilities.test.ts), so a union would produce this exact same result.
  // That distinction is genuinely unobservable until a role exists whose
  // capabilities aren't a subset of a higher-tier role's — see the comment on
  // the chain test for when this stops being true and a discriminating test
  // becomes both possible and necessary.
  it("derives capabilities from the SAME row orgId came from", async () => {
    // admin in X, editor in Y, adversarial order — the same shape as the
    // regression test above this one. Capabilities must describe X (the
    // resolved org), never a union across both rows.
    const getMyRoles = await loadGetMyRoles([
      { role: "editor", org_id: "org-Y" },
      { role: "admin", org_id: "org-X" },
    ]);
    const r = await getMyRoles();
    expect(r!.orgId).toBe("org-X");
    expect(r!.capabilities).toContain("manage_team");
  });

  // Same caveat as above: marshal's capabilities are a subset of editor's, so
  // this too can't distinguish "from resolvedRow" from "union across rows"
  // today. Kept because it does verify the orgId/capabilities pairing (org-E,
  // not org-M) under adversarial order, which is real coverage even though
  // the union-vs-resolved-row question specifically remains open until the
  // chain breaks.
  it("does not let a marshal row in another org add capabilities to the resolved org", async () => {
    const getMyRoles = await loadGetMyRoles([
      { role: "editor", org_id: "org-E" },
      { role: "marshal", org_id: "org-M" },
    ]);
    const r = await getMyRoles();
    expect(r!.orgId).toBe("org-E");
    expect(r!.capabilities).toEqual(expect.arrayContaining(["manage_org", "check_in"]));
    expect(r!.capabilities).not.toContain("manage_team");
  });

  // The specific fallthrough this task added: admin ?? editor ?? marshal.
  // Only admin-vs-editor and editor-vs-marshal were covered before; this pins
  // the case that actually matters for a marshal who also holds an admin row
  // (e.g. admin of their home org, marshal-only at an event they're helping
  // out at another org) — admin must win, in either row order.
  it("resolves to the admin org, not the marshal org, when the marshal row sorts first", async () => {
    const getMyRoles = await loadGetMyRoles([
      { role: "marshal", org_id: "org-M" },
      { role: "admin", org_id: "org-X" },
    ]);
    const r = await getMyRoles();
    expect(r!.orgId).toBe("org-X");
    expect(r!.capabilities).toContain("manage_team");
    expect(r!.isOrgAdmin).toBe(true);
  });

  // Regression test for the bug Fix 1 addresses: `isAdmin` used to be
  // `isSuperAdmin || !!resolvedRow`, and once resolvedRow's fallthrough grew
  // to admit marshal (`find(admin) ?? find(editor) ?? find(marshal)`),
  // isAdmin silently started being true for a marshal too — even though
  // every consumer (assertCanWriteEvent, the events-table write controls,
  // login routing) still means "admin, editor or super_admin" when it reads
  // isAdmin. Defining isAdmin via the `manage_org` capability — which
  // marshal never holds — is what keeps the set correct regardless of what
  // resolvedRow's fallthrough grows to include next.
  it("keeps isAdmin false for a marshal-only account", async () => {
    const getMyRoles = await loadGetMyRoles([{ role: "marshal", org_id: "org-M" }]);
    const r = await getMyRoles();
    expect(r!.isAdmin).toBe(false);
  });

  it.each(["admin", "editor"])("keeps isAdmin true for a resolved %s row", async (role) => {
    const getMyRoles = await loadGetMyRoles([{ role, org_id: "org-1" }]);
    const r = await getMyRoles();
    expect(r!.isAdmin).toBe(true);
  });

  it("keeps isAdmin true for a bare super admin", async () => {
    const getMyRoles = await loadGetMyRoles([{ role: "super_admin", org_id: "" }]);
    const r = await getMyRoles();
    expect(r!.isAdmin).toBe(true);
  });

  it("gives a bare super admin every capability", async () => {
    const getMyRoles = await loadGetMyRoles([{ role: "super_admin", org_id: "" }]);
    const r = await getMyRoles();
    expect(r!.capabilities).toContain("manage_platform");
    expect(r!.capabilities).toContain("manage_team");
  });

  // A super admin who ALSO holds a real org-scoped row (e.g. admin of their
  // home org) keeps that org's id via resolvedRow — see the "resolvedRow
  // first" comment in roles.ts — while still getting every capability via the
  // isSuperAdmin short-circuit in capabilitiesFor, not via resolvedRow's role.
  // Uses loadGetMyRolesWithOrgContext (not the shared loadGetMyRoles) so the
  // org-context fallback resolves to a DIFFERENT org than the real row —
  // "org-E" vs "org-FROM-CONTEXT" — making the precedence actually testable.
  it("keeps the org id from a super admin's real row while still granting every capability", async () => {
    const getMyRoles = await loadGetMyRolesWithOrgContext([
      { role: "super_admin", org_id: "" },
      { role: "editor", org_id: "org-E" },
    ]);
    const r = await getMyRoles();
    expect(r!.orgId).toBe("org-E");
    expect(r!.orgId).not.toBe("org-FROM-CONTEXT");
    expect(r!.capabilities).toContain("manage_platform");
    expect(r!.capabilities).toContain("manage_team");
  });
});
