import { describe, expect, it } from "vitest";
import {
  isCurrentRegistration,
  isSuspended,
  latestByDate,
  passportDisplayName,
  providerFor,
  userDisplayName,
} from "./platformUsers";

const base = { id: "u1", created_at: "2026-09-01T00:00:00Z" };

describe("platform user helpers", () => {
  it("prefers Google when an account has Google and email identities", () => {
    expect(providerFor({ ...base, app_metadata: { providers: ["email", "google"] } })).toBe("google");
  });

  it("recognizes manual email accounts and preserves unknown providers", () => {
    expect(providerFor({ ...base, identities: [{ provider: "email" }] })).toBe("email");
    expect(providerFor({ ...base, identities: [{ provider: "apple" }] })).toBe("other");
  });

  it("treats only a future valid ban as suspended", () => {
    const now = new Date("2026-09-20T00:00:00Z");
    expect(isSuspended({ banned_until: "2126-09-20T00:00:00Z" }, now)).toBe(true);
    expect(isSuspended({ banned_until: "2026-09-19T00:00:00Z" }, now)).toBe(false);
    expect(isSuspended({ banned_until: null }, now)).toBe(false);
  });

  it("uses profile, metadata, then email for account names", () => {
    const user = { ...base, email: "runner@example.com", user_metadata: { full_name: "Metadata Runner" } };
    expect(userDisplayName(user, "Profile Runner")).toBe("Profile Runner");
    expect(userDisplayName(user)).toBe("Metadata Runner");
    expect(userDisplayName({ ...base, email: "runner@example.com" })).toBe("runner");
  });

  it("builds Passport names without inventing missing values", () => {
    expect(passportDisplayName({ first_name: "Maya", last_name: "Santos" })).toBe("Maya Santos");
    expect(passportDisplayName({ legacy_full_name: "Legacy Runner" })).toBe("Legacy Runner");
    expect(passportDisplayName({})).toBe("Unnamed participant");
  });

  it("classifies current registrations and selects the latest dated record", () => {
    const today = new Date("2026-09-20T00:00:00Z");
    expect(isCurrentRegistration({ status: "paid", eventDate: "2026-09-20" }, today)).toBe(true);
    expect(isCurrentRegistration({ status: "paid", eventDate: "2026-10-01", eventStatus: "cancelled" }, today)).toBe(false);
    expect(isCurrentRegistration({ status: "refunded", eventDate: "2026-10-01" }, today)).toBe(false);
    expect(isCurrentRegistration({ status: "paid", eventDate: "2026-09-19" }, today)).toBe(false);
    expect(latestByDate([{ id: 1, at: "2026-01-01" }, { id: 2, at: "2026-02-01" }], (row) => row.at)?.id).toBe(2);
  });
});
