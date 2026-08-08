import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { RegistrationHistory } from "./RegistrationHistory";
import type { AuditRow } from "@/lib/audit";

let auditResult: { data: AuditRow[] | null; error: unknown } = { data: [], error: null };

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ order: () => Promise.resolve(auditResult) }) }),
    }),
  }),
}));

const row = (over: Partial<AuditRow>): AuditRow => ({
  id: Math.random().toString(36).slice(2), action: "field_changed",
  detail: { field: "shirt_size", from: "M", to: "L" },
  actor_role: "runner", created_at: "2026-08-08T06:22:00Z", ...over,
});

beforeEach(() => {
  auditResult = { data: [], error: null };
});

describe("RegistrationHistory", () => {
  it("shows the old value alongside the new one", async () => {
    auditResult = { data: [row({})], error: null };
    render(<RegistrationHistory registrationId="r1" />);
    expect(await screen.findByText("Shirt size")).toBeInTheDocument();
    expect(screen.getByText("M")).toBeInTheDocument();
    expect(screen.getByText("L")).toBeInTheDocument();
  });

  it("renders an absent previous value as empty rather than blank", async () => {
    auditResult = { data: [row({ detail: { field: "blood_type", from: null, to: "B-" } })], error: null };
    render(<RegistrationHistory registrationId="r1" />);
    expect(await screen.findByText("empty")).toBeInTheDocument();
  });

  it("attributes an organiser edit to the organiser, not the runner", async () => {
    auditResult = { data: [row({ actor_role: "admin" })], error: null };
    render(<RegistrationHistory registrationId="r1" />);
    expect(await screen.findByText(/organiser/i)).toBeInTheDocument();
  });

  it("collapses a payment entry to a single line", async () => {
    auditResult = { data: [row({ action: "paid", detail: { method: "gcash", amount: 230000 }, actor_role: "system" })], error: null };
    render(<RegistrationHistory registrationId="r1" />);
    expect(await screen.findByText(/paid/i)).toBeInTheDocument();
    expect(screen.queryByText("empty")).not.toBeInTheDocument();
  });

  it("labels a partial refund distinctly rather than as a raw action string", async () => {
    auditResult = {
      data: [row({ action: "partially_refunded", detail: { amount: 50000, note: "one add-on" }, actor_role: "admin" })],
      error: null,
    };
    render(<RegistrationHistory registrationId="r1" />);
    expect(await screen.findByText(/partially refunded/i)).toBeInTheDocument();
    expect(screen.queryByText("partially_refunded")).not.toBeInTheDocument();
  });

  it("says so plainly when there is no history yet", async () => {
    auditResult = { data: [], error: null };
    render(<RegistrationHistory registrationId="r1" />);
    expect(await screen.findByText(/no changes yet/i)).toBeInTheDocument();
  });

  it("renders nothing rather than an empty-state lie when the query fails", async () => {
    auditResult = { data: null, error: new Error("boom") };
    render(<RegistrationHistory registrationId="r1" />);
    await waitFor(() => expect(screen.queryByText(/no changes yet/i)).not.toBeInTheDocument());
  });
});
