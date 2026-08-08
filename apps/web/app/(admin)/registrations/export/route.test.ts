import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TableParams } from "@/lib/table-params";
import type { MyRoles } from "@/lib/queries/roles";
import type { RegistrationRow } from "@/lib/queries/registrations";

const { getMyRolesMock, listEventRegistrationsMock, listOrgEventOptionsMock, getEventRegistrationEmailsMock } =
  vi.hoisted(() => ({
    getMyRolesMock: vi.fn(),
    listEventRegistrationsMock: vi.fn(),
    listOrgEventOptionsMock: vi.fn(),
    getEventRegistrationEmailsMock: vi.fn(),
  }));

// requireOrgId is pure (see lib/queries/roles.ts) — only getMyRoles needs
// mocking, so import the real requireOrgId alongside the mocked getMyRoles
// rather than re-implementing its null-check logic here.
vi.mock("@/lib/queries/roles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/roles")>();
  return { ...actual, getMyRoles: getMyRolesMock };
});

vi.mock("@/lib/queries/registrations", () => ({
  listEventRegistrations: listEventRegistrationsMock,
  listOrgEventOptions: listOrgEventOptionsMock,
  getEventRegistrationEmails: getEventRegistrationEmailsMock,
}));

import { GET } from "./route";

function roles(overrides: Partial<MyRoles> = {}): MyRoles {
  return { role: "admin", orgId: "org-1", isSuperAdmin: false, isAdmin: true, isOrgAdmin: false, ...overrides };
}

// email is never read off the row by the route anymore (it's looked up from
// the hoisted getEventRegistrationEmails() map instead — see MINOR 2 in the
// review), but the type still carries the field since listEventRegistrations
// itself still returns it. Left populated here to catch a regression that
// would embarrassingly read row.email again instead of the map.
function row(overrides: Partial<RegistrationRow> = {}): RegistrationRow {
  return {
    id: "reg-1",
    user_id: "u-1",
    category_id: "cat-1",
    category_label: "21K",
    full_name: "Ana Cruz",
    bib_name: "A1",
    email: "WRONG-should-not-be-read-from-the-row",
    total_amount: 150000,
    payment_status: "paid",
    payment_method: "card",
    created_at: "2026-08-04T11:35:15.624Z",
    custom_data: {},
    addons: [],
    ...overrides,
  };
}

async function readBody(res: Response): Promise<string> {
  return res.text();
}

describe("GET /registrations/export", () => {
  beforeEach(() => {
    getMyRolesMock.mockReset();
    listEventRegistrationsMock.mockReset();
    listOrgEventOptionsMock.mockReset();
    getEventRegistrationEmailsMock.mockReset();
    listOrgEventOptionsMock.mockResolvedValue([{ id: "event-1", name: "Dahilayan Sky Ultra", count: 1 }]);
    listEventRegistrationsMock.mockResolvedValue({ rows: [row()], total: 1 });
    getEventRegistrationEmailsMock.mockResolvedValue(new Map([["reg-1", "ana@example.com"]]));
  });

  it("returns 403, not an empty CSV or a redirect, when the caller has no org", async () => {
    getMyRolesMock.mockResolvedValue(roles({ orgId: null, isSuperAdmin: true }));

    const res = await GET(new Request("http://localhost/registrations/export"));

    expect(res.status).toBe(403);
    expect(listEventRegistrationsMock).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("sets Content-Disposition: attachment with a filename carrying the page and today's date", async () => {
    getMyRolesMock.mockResolvedValue(roles());

    const res = await GET(new Request("http://localhost/registrations/export"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const disposition = res.headers.get("Content-Disposition") ?? "";
    expect(disposition).toContain("attachment");
    const today = new Date().toISOString().slice(0, 10);
    expect(disposition).toContain(`registrations-${today}.csv`);
  });

  it("emits a header row followed by the data row, with email from the hoisted map", async () => {
    getMyRolesMock.mockResolvedValue(roles());

    const res = await GET(new Request("http://localhost/registrations/export"));
    const body = await readBody(res);
    const lines = body.split("\r\n").filter(Boolean);

    expect(lines[0]).toBe(
      "Registration ID,Runner,Email,Category,Bib,Registered At (UTC),Amount (PHP),Payment Status,Payment Method",
    );
    expect(lines[1]).toBe("reg-1,Ana Cruz,ana@example.com,21K,A1,2026-08-04T11:35:15.624Z,1500.00,paid,card");
  });

  it("fetches emails ONCE per request, not once per batch (the O(n²) fix)", async () => {
    getMyRolesMock.mockResolvedValue(roles());
    listEventRegistrationsMock
      .mockResolvedValueOnce({ rows: new Array(1000).fill(row()), total: 1300 })
      .mockResolvedValueOnce({ rows: new Array(300).fill(row()), total: 1300 });

    const res = await GET(new Request("http://localhost/registrations/export"));
    await readBody(res); // drains the stream, which is what actually drives pull() through both batches

    expect(getEventRegistrationEmailsMock).toHaveBeenCalledTimes(1);
    expect(getEventRegistrationEmailsMock).toHaveBeenCalledWith("event-1");
    // Both batch calls actually happened (not a vacuously-true empty loop) —
    // and the query builder itself must be told NOT to also do its own
    // per-batch email lookup.
    expect(listEventRegistrationsMock).toHaveBeenCalledTimes(2);
    for (const call of listEventRegistrationsMock.mock.calls) {
      const [, , opts] = call as [string, TableParams, { includeEmails?: boolean; includeAddons?: boolean } | undefined];
      expect(opts?.includeEmails).toBe(false);
      // The export never renders add-ons — same O(n²)-avoidance reasoning as
      // includeEmails, just for a read this route has no use for at all.
      expect(opts?.includeAddons).toBe(false);
    }
  });

  it("requests count only on the first batch, not on every batch", async () => {
    getMyRolesMock.mockResolvedValue(roles());
    listEventRegistrationsMock
      .mockResolvedValueOnce({ rows: new Array(1000).fill(row()), total: 1300 })
      .mockResolvedValueOnce({ rows: new Array(300).fill(row()), total: 1300 });

    const res = await GET(new Request("http://localhost/registrations/export"));
    await readBody(res);

    const [, , firstOpts] = listEventRegistrationsMock.mock.calls[0] as [
      string,
      TableParams,
      { includeCount?: boolean },
    ];
    const [, , secondOpts] = listEventRegistrationsMock.mock.calls[1] as [
      string,
      TableParams,
      { includeCount?: boolean },
    ];
    expect(firstOpts.includeCount).toBe(true);
    expect(secondOpts.includeCount).toBe(false);
  });

  it("escapes a runner name containing a comma so it doesn't shift subsequent columns", async () => {
    getMyRolesMock.mockResolvedValue(roles());
    listEventRegistrationsMock.mockResolvedValue({
      rows: [row({ full_name: "Dela Cruz, Ana" })],
      total: 1,
    });

    const res = await GET(new Request("http://localhost/registrations/export"));
    const body = await readBody(res);
    const dataLine = body.split("\r\n")[1];

    // Split naively on comma would produce 10 fields instead of 9 if the
    // name weren't quoted — assert the quoted form is present verbatim.
    expect(dataLine).toContain('"Dela Cruz, Ana"');
    expect(dataLine.split(",")).toHaveLength(10); // the quoted field's internal comma still splits naively; the quoting is what a real CSV parser relies on
  });

  it("escapes a double-quote and a newline inside a field", async () => {
    getMyRolesMock.mockResolvedValue(roles());
    listEventRegistrationsMock.mockResolvedValue({
      rows: [row({ full_name: 'Quote "Test" Runner', category_label: "Line1\nLine2" })],
      total: 1,
    });

    const res = await GET(new Request("http://localhost/registrations/export"));
    const body = await readBody(res);

    expect(body).toContain('"Quote ""Test"" Runner"');
    expect(body).toContain('"Line1\nLine2"');
  });

  it("neutralizes a formula-injection leading character in a runner name", async () => {
    getMyRolesMock.mockResolvedValue(roles());
    listEventRegistrationsMock.mockResolvedValue({
      rows: [row({ full_name: "=SUM(A1:A9)" })],
      total: 1,
    });

    const res = await GET(new Request("http://localhost/registrations/export"));
    const body = await readBody(res);

    expect(body).toContain("'=SUM(A1:A9)");
    // The raw, un-neutralized formula must never appear as a bare field.
    expect(body).not.toMatch(/,=SUM\(A1:A9\),/);
  });

  it("ignores page/per from the request and exports the whole filtered set in BATCH-sized pages", async () => {
    getMyRolesMock.mockResolvedValue(roles());
    listEventRegistrationsMock
      .mockResolvedValueOnce({ rows: new Array(1000).fill(row()), total: 1300 })
      .mockResolvedValueOnce({ rows: new Array(300).fill(row()), total: 1300 });

    const res = await GET(new Request("http://localhost/registrations/export?page=5&per=10"));
    await readBody(res);

    expect(listEventRegistrationsMock).toHaveBeenCalledTimes(2);
    const [, firstParams] = listEventRegistrationsMock.mock.calls[0] as [string, TableParams];
    const [, secondParams] = listEventRegistrationsMock.mock.calls[1] as [string, TableParams];
    // per is always the batch size (1000, matching this instance's measured
    // PGRST_DB_MAX_ROWS), never the requester's `per=10`.
    expect(firstParams.per).toBe(1000);
    expect(secondParams.per).toBe(1000);
    expect(firstParams.page).toBe(1);
    expect(secondParams.page).toBe(2);
  });

  // The batch-boundary loop was rewritten to live inside pull() for real
  // backpressure (see MINOR 1 in the review) — re-verify its termination
  // condition holds at the exact edges a subtly-wrong `>=`/`>` could get
  // wrong: nothing at all, exactly one full batch, and one row over.
  describe("batch-boundary termination, post pull() rewrite", () => {
    it("total = 0: a single call, zero data rows, no infinite loop", async () => {
      getMyRolesMock.mockResolvedValue(roles());
      listEventRegistrationsMock.mockResolvedValue({ rows: [], total: 0 });

      const res = await GET(new Request("http://localhost/registrations/export"));
      const body = await readBody(res);

      expect(listEventRegistrationsMock).toHaveBeenCalledTimes(1);
      expect(body.trim().split("\r\n")).toHaveLength(1); // header only
    });

    it("total = exactly BATCH (1000): stops after the first full batch, no empty second call", async () => {
      getMyRolesMock.mockResolvedValue(roles());
      listEventRegistrationsMock.mockResolvedValue({ rows: new Array(1000).fill(row()), total: 1000 });

      const res = await GET(new Request("http://localhost/registrations/export"));
      const body = await readBody(res);

      expect(listEventRegistrationsMock).toHaveBeenCalledTimes(1);
      expect(body.trim().split("\r\n")).toHaveLength(1001); // header + 1000 rows
    });

    it("total = BATCH + 1 (1001): a second batch of exactly 1 row is fetched", async () => {
      getMyRolesMock.mockResolvedValue(roles());
      listEventRegistrationsMock
        .mockResolvedValueOnce({ rows: new Array(1000).fill(row()), total: 1001 })
        .mockResolvedValueOnce({ rows: new Array(1).fill(row()), total: 1001 });

      const res = await GET(new Request("http://localhost/registrations/export"));
      const body = await readBody(res);

      expect(listEventRegistrationsMock).toHaveBeenCalledTimes(2);
      expect(body.trim().split("\r\n")).toHaveLength(1002); // header + 1001 rows
    });
  });

  it("honours filters from the query string — same status/category the page would apply", async () => {
    getMyRolesMock.mockResolvedValue(roles());

    const res = await GET(new Request("http://localhost/registrations/export?status=paid&category=cat-9&q=cruz"));
    await readBody(res); // drains the stream — the batch fetch happens inside pull(), not eagerly

    const [, calledParams] = listEventRegistrationsMock.mock.calls[0] as [string, TableParams];
    expect(calledParams.filters.status).toBe("paid");
    expect(calledParams.filters.category).toBe("cat-9");
    expect(calledParams.q).toBe("cruz");
  });

  it("resolves an explicit ?event= to the matching event id", async () => {
    getMyRolesMock.mockResolvedValue(roles());
    listOrgEventOptionsMock.mockResolvedValue([
      { id: "event-1", name: "A", count: 1 },
      { id: "event-2", name: "B", count: 1 },
    ]);

    const res = await GET(new Request("http://localhost/registrations/export?event=event-2"));
    await readBody(res);

    const [calledEventId] = listEventRegistrationsMock.mock.calls[0] as [string, TableParams];
    expect(calledEventId).toBe("event-2");
  });

  it("falls back to the org's first (most recent) event when ?event= is absent, mirroring the page's default", async () => {
    getMyRolesMock.mockResolvedValue(roles());
    listOrgEventOptionsMock.mockResolvedValue([
      { id: "event-recent", name: "Recent", count: 1 },
      { id: "event-old", name: "Old", count: 1 },
    ]);

    const res = await GET(new Request("http://localhost/registrations/export"));
    await readBody(res);

    const [calledEventId] = listEventRegistrationsMock.mock.calls[0] as [string, TableParams];
    expect(calledEventId).toBe("event-recent");
  });

  it("returns a header-only CSV, not an error, when the org has no events at all", async () => {
    getMyRolesMock.mockResolvedValue(roles());
    listOrgEventOptionsMock.mockResolvedValue([]);

    const res = await GET(new Request("http://localhost/registrations/export"));
    const body = await readBody(res);

    expect(res.status).toBe(200);
    expect(listEventRegistrationsMock).not.toHaveBeenCalled();
    expect(getEventRegistrationEmailsMock).not.toHaveBeenCalled();
    expect(body.trim().split("\r\n")).toHaveLength(1);
  });
});
