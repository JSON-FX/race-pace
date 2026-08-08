import { describe, it, expect } from "vitest";
import { groupByDay, type AuditRow } from "./audit";

const row = (over: Partial<AuditRow>): AuditRow => ({
  id: Math.random().toString(36).slice(2), action: "field_changed",
  detail: { field: "shirt_size", from: "M", to: "L" },
  actor_role: "runner", created_at: "2026-08-08T06:22:00Z", ...over,
});

describe("groupByDay", () => {
  it("groups entries under one heading per day, newest day first", () => {
    // groupByDay buckets by toLocaleDateString in the process's local timezone (it's rendering
    // an admin's own local view of "today"/"yesterday"). The suite now pins TZ=America/New_York
    // (UTC-4 in August), so these UTC timestamps have to land on the intended local calendar
    // day under THAT offset, not just under UTC: 01:10Z would read as 21:10 the PREVIOUS local
    // day at UTC-4, splitting what this fixture means to be one day into two. 05:10Z (01:10
    // local) and 09:58Z (05:58 local) both land on Aug 6 local under UTC-4.
    const groups = groupByDay([
      row({ created_at: "2026-08-08T06:22:00Z" }),
      row({ created_at: "2026-08-06T05:10:00Z" }),
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
