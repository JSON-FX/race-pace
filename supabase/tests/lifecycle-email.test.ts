import { afterEach, expect, it, vi } from "vitest";
import { renderLifecycleEmail, type LifecycleEmailType } from "../functions/_shared/lifecycleEmail.ts";

afterEach(() => vi.unstubAllGlobals());
const input = { eventName: "Trail <script>alert(1)</script>", participantName: "Runner & Friend", eventDate: "2026-12-01", actionUrl: "https://staging.racepace.com.ph/events/event-id" };
it.each<LifecycleEmailType>(["event_rescheduled", "event_cancelled", "event_updated", "payment_failed", "payment_expiring"])("renders %s while escaping organizer content", (type) => {
  const result = renderLifecycleEmail({ ...input, type, previousEventDate: "2026-11-01", changedFields: ["venue", "venue", "unknown"], statusNote: "<img src=x>", expiresAt: "2026-10-06T16:00:00Z" });
  expect(result.subject).toBeTruthy();
  expect(result.html).not.toContain("<script>");
  expect(result.html).not.toContain("<img src=x>");
  expect(result.html).toContain("&lt;script&gt;");
  expect(result.html).toContain("Runner &amp; Friend");
  expect(result.text).toContain(input.actionUrl);
});
it("marks staging mail in both formats and uses its staging brand asset", () => {
  vi.stubGlobal("Deno", { env: { get: () => "staging" } });
  const result = renderLifecycleEmail({ ...input, type: "event_updated" });
  expect(result.html).toContain("TEST — STAGING");
  expect(result.text).toContain("TEST — STAGING");
  expect(result.html).toContain("pepbmqomiailnnvvwupz.supabase.co");
});
