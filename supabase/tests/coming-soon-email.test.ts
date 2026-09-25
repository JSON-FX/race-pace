import { expect, it } from "vitest";
import { renderComingSoonEmail } from "../functions/_shared/comingSoonEmail";

it("sends an opening notice with an escaped event name and no reservation charge", () => {
  const mail = renderComingSoonEmail({
    type: "coming_soon_opened", eventName: "Trail <Summit>",
    eventUrl: "https://racepace.example/events/summit",
  });
  expect(mail.subject).toContain("Registration is open");
  expect(mail.html).toContain("Trail &lt;Summit&gt;");
  expect(mail.html).not.toContain("Amount paid");
  expect(mail.text).toContain("Choose an available category");
});

it("receipts explain the separate nonrefundable fee and entry deadline", () => {
  const mail = renderComingSoonEmail({
    type: "reservation_paid", eventName: "Summit", eventUrl: "https://racepace.example/events/summit",
    reservationUrl: "https://racepace.example/reservations/one",
    deadline: "15 October 2026, 11:59 PM", totalCents: 53500,
  });
  expect(mail.text).toContain("nonrefundable");
  expect(mail.text).toContain("Amount paid: ₱535.00");
  expect(mail.text).toContain("15 October 2026, 11:59 PM PHT");
  expect(mail.html).toContain("https://racepace.example/reservations/one");
});
