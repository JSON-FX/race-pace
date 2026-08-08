import { describe, it, expect } from "vitest";
import { groupByDay, type AuditRow } from "./audit";

const row = (over: Partial<AuditRow>): AuditRow => ({
  id: Math.random().toString(36).slice(2), action: "field_changed",
  detail: { field: "shirt_size", from: "M", to: "L" },
  actor_role: "runner", created_at: "2026-08-08T06:22:00Z", ...over,
});

describe("groupByDay", () => {
  it("groups entries under one heading per day, newest day first", () => {
    const groups = groupByDay([
      row({ created_at: "2026-08-08T06:22:00Z" }),
      row({ created_at: "2026-08-06T01:10:00Z" }),
      row({ created_at: "2026-08-06T09:58:00Z" }),
    ]);
    expect(groups.length).toBe(2);
    expect(groups[0].rows.length).toBe(1);
    expect(groups[1].rows.length).toBe(2);
  });

  it("returns nothing for an empty log", () => {
    expect(groupByDay([])).toEqual([]);
  });
});
