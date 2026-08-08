import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TableParams } from "@/lib/table-params";
import type { MyRoles } from "@/lib/queries/roles";
import type { PaymentRow } from "@/lib/queries/payments";

const { getMyRolesMock, listOrgPaymentsMock } = vi.hoisted(() => ({
  getMyRolesMock: vi.fn(),
  listOrgPaymentsMock: vi.fn(),
}));

vi.mock("@/lib/queries/roles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/roles")>();
  return { ...actual, getMyRoles: getMyRolesMock };
});

vi.mock("@/lib/queries/payments", () => ({
  listOrgPayments: listOrgPaymentsMock,
}));

import { GET } from "./route";

function roles(overrides: Partial<MyRoles> = {}): MyRoles {
  return { role: "admin", orgId: "org-1", isSuperAdmin: false, isAdmin: true, isOrgAdmin: false, ...overrides };
}

function row(overrides: Partial<PaymentRow> = {}): PaymentRow {
  return {
    registration_id: "reg-1",
    event_id: "event-1",
    event_name: "Dahilayan Sky Ultra",
    user_id: "u-1",
    full_name: "Ana Cruz",
    avatar_url: null,
    amount: 150000,
    platform_fee: 4500,
    net_to_org: 145500,
    method: "gcash",
    status: "paid",
    created_at: "2026-08-04T11:35:15.624Z",
    ...overrides,
  };
}

async function readBody(res: Response): Promise<string> {
  return res.text();
}

describe("GET /payments/export", () => {
  beforeEach(() => {
    getMyRolesMock.mockReset();
    listOrgPaymentsMock.mockReset();
    listOrgPaymentsMock.mockResolvedValue({ rows: [row()], total: 1 });
  });

  it("returns 403, not an empty CSV or a redirect, when the caller has no org", async () => {
    getMyRolesMock.mockResolvedValue(roles({ orgId: null, isSuperAdmin: true }));

    const res = await GET(new Request("http://localhost/payments/export"));

    expect(res.status).toBe(403);
    expect(listOrgPaymentsMock).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("sets Content-Disposition: attachment with a filename carrying the page and today's date", async () => {
    getMyRolesMock.mockResolvedValue(roles());

    const res = await GET(new Request("http://localhost/payments/export"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const disposition = res.headers.get("Content-Disposition") ?? "";
    expect(disposition).toContain("attachment");
    const today = new Date().toISOString().slice(0, 10);
    expect(disposition).toContain(`payments-${today}.csv`);
  });

  it("emits a header row followed by the data row, money as plain decimals", async () => {
    getMyRolesMock.mockResolvedValue(roles());

    const res = await GET(new Request("http://localhost/payments/export"));
    const body = await readBody(res);
    const lines = body.split("\r\n").filter(Boolean);

    expect(lines[0]).toBe(
      "Registration ID,Event,Runner,Amount (PHP),Platform Fee (PHP),Net to Org (PHP),Method,Status,Date (UTC)",
    );
    expect(lines[1]).toBe(
      "reg-1,Dahilayan Sky Ultra,Ana Cruz,1500.00,45.00,1455.00,gcash,paid,2026-08-04T11:35:15.624Z",
    );
  });

  it("escapes an event name containing a comma", async () => {
    getMyRolesMock.mockResolvedValue(roles());
    listOrgPaymentsMock.mockResolvedValue({
      rows: [row({ event_name: "Dahilayan Sky Ultra, 60K" })],
      total: 1,
    });

    const res = await GET(new Request("http://localhost/payments/export"));
    const body = await readBody(res);

    expect(body).toContain('"Dahilayan Sky Ultra, 60K"');
  });

  it("escapes a double-quote and a newline inside a field", async () => {
    getMyRolesMock.mockResolvedValue(roles());
    listOrgPaymentsMock.mockResolvedValue({
      rows: [row({ full_name: 'Quote "Test" Runner' })],
      total: 1,
    });

    const res = await GET(new Request("http://localhost/payments/export"));
    const body = await readBody(res);

    expect(body).toContain('"Quote ""Test"" Runner"');
  });

  it("neutralizes a formula-injection leading character in a runner name", async () => {
    getMyRolesMock.mockResolvedValue(roles());
    listOrgPaymentsMock.mockResolvedValue({
      rows: [row({ full_name: "=SUM(A1:A9)+Injection" })],
      total: 1,
    });

    const res = await GET(new Request("http://localhost/payments/export"));
    const body = await readBody(res);

    expect(body).toContain("'=SUM(A1:A9)+Injection");
    expect(body).not.toMatch(/,=SUM\(A1:A9\)\+Injection,/);
  });

  it("ignores page/per from the request and exports the whole filtered set in BATCH-sized pages", async () => {
    getMyRolesMock.mockResolvedValue(roles());
    listOrgPaymentsMock
      .mockResolvedValueOnce({ rows: new Array(1000).fill(row()), total: 1300 })
      .mockResolvedValueOnce({ rows: new Array(300).fill(row()), total: 1300 });

    const res = await GET(new Request("http://localhost/payments/export?page=5&per=10"));
    await readBody(res);

    expect(listOrgPaymentsMock).toHaveBeenCalledTimes(2);
    const [, firstParams] = listOrgPaymentsMock.mock.calls[0] as [string, TableParams];
    const [, secondParams] = listOrgPaymentsMock.mock.calls[1] as [string, TableParams];
    expect(firstParams.per).toBe(1000);
    expect(secondParams.per).toBe(1000);
    expect(firstParams.page).toBe(1);
    expect(secondParams.page).toBe(2);
  });

  it("requests count only on the first batch, not on every batch", async () => {
    getMyRolesMock.mockResolvedValue(roles());
    listOrgPaymentsMock
      .mockResolvedValueOnce({ rows: new Array(1000).fill(row()), total: 1300 })
      .mockResolvedValueOnce({ rows: new Array(300).fill(row()), total: 1300 });

    const res = await GET(new Request("http://localhost/payments/export"));
    await readBody(res); // drains the stream — the batch fetch happens inside pull(), not eagerly

    const [, , firstOpts] = listOrgPaymentsMock.mock.calls[0] as [string, TableParams, { includeCount?: boolean }];
    const [, , secondOpts] = listOrgPaymentsMock.mock.calls[1] as [string, TableParams, { includeCount?: boolean }];
    expect(firstOpts.includeCount).toBe(true);
    expect(secondOpts.includeCount).toBe(false);
  });

  // The batch loop was rewritten to live inside pull() for real backpressure
  // (see MINOR 1 in the review) — re-verify termination at the exact edges:
  // nothing at all, exactly one full batch, and one row over.
  describe("batch-boundary termination, post pull() rewrite", () => {
    it("total = 0: a single call, zero data rows, no infinite loop", async () => {
      getMyRolesMock.mockResolvedValue(roles());
      listOrgPaymentsMock.mockResolvedValue({ rows: [], total: 0 });

      const res = await GET(new Request("http://localhost/payments/export"));
      const body = await readBody(res);

      expect(listOrgPaymentsMock).toHaveBeenCalledTimes(1);
      expect(body.trim().split("\r\n")).toHaveLength(1); // header only
    });

    it("total = exactly BATCH (1000): stops after the first full batch, no empty second call", async () => {
      getMyRolesMock.mockResolvedValue(roles());
      listOrgPaymentsMock.mockResolvedValue({ rows: new Array(1000).fill(row()), total: 1000 });

      const res = await GET(new Request("http://localhost/payments/export"));
      const body = await readBody(res);

      expect(listOrgPaymentsMock).toHaveBeenCalledTimes(1);
      expect(body.trim().split("\r\n")).toHaveLength(1001); // header + 1000 rows
    });

    it("total = BATCH + 1 (1001): a second batch of exactly 1 row is fetched", async () => {
      getMyRolesMock.mockResolvedValue(roles());
      listOrgPaymentsMock
        .mockResolvedValueOnce({ rows: new Array(1000).fill(row()), total: 1001 })
        .mockResolvedValueOnce({ rows: new Array(1).fill(row()), total: 1001 });

      const res = await GET(new Request("http://localhost/payments/export"));
      const body = await readBody(res);

      expect(listOrgPaymentsMock).toHaveBeenCalledTimes(2);
      expect(body.trim().split("\r\n")).toHaveLength(1002); // header + 1001 rows
    });
  });

  it("honours filters from the query string — same status/method the page would apply", async () => {
    getMyRolesMock.mockResolvedValue(roles());

    const res = await GET(new Request("http://localhost/payments/export?status=refunded&method=gcash&q=ana"));
    await readBody(res);

    const [orgId, calledParams] = listOrgPaymentsMock.mock.calls[0] as [string, TableParams];
    expect(orgId).toBe("org-1");
    expect(calledParams.filters.status).toBe("refunded");
    expect(calledParams.filters.method).toBe("gcash");
    expect(calledParams.q).toBe("ana");
  });
});
