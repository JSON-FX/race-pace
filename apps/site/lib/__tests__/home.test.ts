import { describe, it, expect } from "vitest";
import { homeMode } from "../home";

// No deadline case only — isRegistrationClosed's own date-vs-status
// precedence is covered by eventStatus.test.ts; this file is homeMode's
// filter/count logic.
const ev = (status: string) => ({ status, registration_closes_at: null });

describe("homeMode", () => {
  it("is multi with exactly one registerable event — there is no longer a single-event mode", () => {
    expect(homeMode([ev("open")])).toBe("multi");
  });

  it("is multi with a lone almost_full event — it is still registerable", () => {
    expect(homeMode([ev("almost_full")])).toBe("multi");
  });

  it("is multi with two or more registerable events", () => {
    expect(homeMode([ev("open"), ev("almost_full")])).toBe("multi");
  });

  it("is empty with zero events", () => {
    expect(homeMode([])).toBe("empty");
  });

  it("is empty when the only event is cancelled", () => {
    expect(homeMode([ev("cancelled")])).toBe("empty");
  });

  it("is empty when every event is closed or completed, even several of them", () => {
    expect(homeMode([ev("closed"), ev("completed"), ev("cancelled")])).toBe("empty");
  });

  it("counts only the registerable subset — one open among several closed is multi", () => {
    expect(homeMode([ev("closed"), ev("open"), ev("completed")])).toBe("multi");
  });
});
