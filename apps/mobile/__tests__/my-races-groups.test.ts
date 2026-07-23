import { groupMyRaces, defaultSegment } from "../lib/myRacesGroups";
import type { RegistrationRow } from "../lib/registration";

const TODAY = "2026-07-23";

function row(overrides: Partial<RegistrationRow> = {}): RegistrationRow {
  return {
    id: "r1", status: "paid", total_amount: 120000, ticket_token: "a.b", org_id: "o1",
    eventName: "Test Race", categoryLabel: "21K", categoryDistance: 21, checkoutUrl: null,
    eventStatus: "open", eventDate: "2026-10-18", originalDate: null, statusNote: null,
    payment: null,
    ...overrides,
  };
}

describe("groupMyRaces", () => {
  it("puts a paid, future-dated race in registered", () => {
    const g = groupMyRaces([row({ id: "a", status: "paid", eventDate: "2026-10-18" })], TODAY);
    expect(g.registered.map((r) => r.id)).toEqual(["a"]);
    expect(g.completed).toHaveLength(0);
  });
  it("puts a paid, past-dated race in completed", () => {
    const g = groupMyRaces([row({ id: "a", status: "paid", eventDate: "2026-01-10" })], TODAY);
    expect(g.completed.map((r) => r.id)).toEqual(["a"]);
    expect(g.registered).toHaveLength(0);
  });
  it("treats a paid race whose event status is 'completed' as completed even if dated ahead", () => {
    const g = groupMyRaces([row({ id: "a", status: "paid", eventStatus: "completed", eventDate: "2026-12-31" })], TODAY);
    expect(g.completed.map((r) => r.id)).toEqual(["a"]);
  });
  it("treats a paid race with no event date as registered", () => {
    const g = groupMyRaces([row({ id: "a", status: "paid", eventDate: null })], TODAY);
    expect(g.registered.map((r) => r.id)).toEqual(["a"]);
  });
  it("puts refunded races in completed", () => {
    const g = groupMyRaces([row({ id: "a", status: "refunded", eventDate: "2026-10-18" })], TODAY);
    expect(g.completed.map((r) => r.id)).toEqual(["a"]);
  });
  it("puts pending races in unpaid", () => {
    const g = groupMyRaces([row({ id: "a", status: "pending" })], TODAY);
    expect(g.unpaid.map((r) => r.id)).toEqual(["a"]);
  });
  it("excludes cancelled races from every group", () => {
    const g = groupMyRaces([row({ id: "a", status: "cancelled" })], TODAY);
    expect(g.registered).toHaveLength(0);
    expect(g.completed).toHaveLength(0);
    expect(g.unpaid).toHaveLength(0);
  });
  it("reports counts", () => {
    const g = groupMyRaces([
      row({ id: "a", status: "paid", eventDate: "2026-10-18" }),
      row({ id: "b", status: "paid", eventDate: "2026-01-01" }),
      row({ id: "c", status: "pending" }),
    ], TODAY);
    expect(g.counts).toEqual({ registered: 1, completed: 1, unpaid: 1 });
  });
});

describe("defaultSegment", () => {
  it("defaults to registered", () => {
    const g = groupMyRaces([row({ status: "paid", eventDate: "2026-10-18" })], TODAY);
    expect(defaultSegment(g)).toBe("registered");
  });
  it("falls back to unpaid when registered is empty but unpaid isn't", () => {
    const g = groupMyRaces([row({ status: "pending" })], TODAY);
    expect(defaultSegment(g)).toBe("unpaid");
  });
});
