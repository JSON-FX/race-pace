import { expect, it } from "vitest";
import { renderPrescreeningEmail } from "../functions/_shared/prescreeningEmail";
it("names approved categories, authenticates through the request, and preserves the original deadline", () => {
  const mail = renderPrescreeningEmail({ type: "prescreening_ready", eventName: "Trail <Run>", requestUrl: "https://racepace.example/prescreening/request", intent: "reservation", participants: [{ name: "Alex", category: "70K" }, { name: "Mika", category: "21K" }], deadline: "4 October, 9:00 AM" });
  expect(mail.html).toContain("Trail &lt;Run&gt;"); expect(mail.text).toContain("Mika — 21K");
  expect(mail.text).toContain("4 October, 9:00 AM PHT"); expect(mail.text).toContain("Resending never extends");
  expect(mail.text).toContain("Sign in with the booking account"); expect(mail.text).toContain("not deducted");
});
it("escapes rejection reasons and explains only one released slot", () => {
  const mail = renderPrescreeningEmail({ type: "prescreening_rejected", eventName: "Trail", requestUrl: "https://racepace.example/prescreening/request", intent: "entry", participants: [{name: "Alex", category: "70K"}], reason: "<img src=x onerror=alert(1)>" });
  expect(mail.html).not.toContain("<img src=x"); expect(mail.html).toContain("&lt;img");
  expect(mail.text).toContain("Only their slot has been released"); expect(mail.text).not.toContain("reservation fee");
});

it.each(["completed", "cancelled", "expired", "reviewing"] as const)("does not invite payment from a delayed approval email when %s", currentStatus => {
  const mail = renderPrescreeningEmail({ type: "prescreening_ready", currentStatus, eventName: "Trail", requestUrl: "https://racepace.example/prescreening/request", intent: "entry", participants: [{name: "Alex", category: "70K"}], deadline: "4 October" });
  expect(mail.subject).not.toContain("ready to pay");
  expect(mail.text).toContain("current booking and payment status");
  expect(mail.text).not.toContain("Complete one");
  expect(mail.text).not.toContain("Payment deadline:");
});

it("confirms free holds for own and managed Passports without asking for payment", () => {
  const mail = renderPrescreeningEmail({ type: "prescreening_submitted", currentStatus: "reviewing", eventName: "North Ridge", requestUrl: "https://racepace.example/prescreening/request", intent: "reservation", participants: [
    { name: "Alex <Reyes>", category: "70K", decision: "pending", managed: false },
    { name: "Mika Reyes", category: "21K", decision: "not_required", managed: true },
  ] });
  expect(mail.subject).toContain("awaiting approval");
  expect(mail.text).toContain("All selected slots are secured");
  expect(mail.text).toContain("No entry or reservation payment is due now");
  expect(mail.text).toContain("72-hour payment window has not started");
  expect(mail.text).toContain("Alex <Reyes> — 70K · Your Passport · Pending approval — slot held");
  expect(mail.text).toContain("Mika Reyes — 21K · Managed Passport · No review needed — slot held with the group");
  expect(mail.html).toContain("Alex &lt;Reyes&gt;");
  expect(mail.html).not.toContain("Alex <Reyes>");
  expect(mail.text).not.toContain("Payment deadline:");
});

it.each(["ready", "completed", "cancelled", "expired"] as const)("does not claim pending approval from a delayed submission email when %s", currentStatus => {
  const mail = renderPrescreeningEmail({ type: "prescreening_submitted", currentStatus, eventName: "Trail", requestUrl: "https://racepace.example/prescreening/request", intent: "entry", participants: [{name: "Alex", category: "70K", decision: "approved"}] });
  expect(mail.subject).not.toContain("awaiting approval");
  expect(mail.text).toContain("current booking and payment status");
  expect(mail.text).not.toContain("slots are secured");
  expect(mail.text).not.toContain("did not approve");
});


it("does not claim every slot is held after a partial rejection delays the submission email", () => {
  const mail = renderPrescreeningEmail({ type: "prescreening_submitted", currentStatus: "reviewing", eventName: "Trail", requestUrl: "https://racepace.example/prescreening/request", intent: "entry", participants: [{name: "Alex", category: "70K", decision: "pending"}, {name: "Mika", category: "70K", decision: "rejected"}] });
  expect(mail.text).not.toContain("All selected slots are secured");
  expect(mail.text).toContain("current booking and payment status");
});
