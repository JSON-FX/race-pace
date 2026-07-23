import { routeFor } from "../lib/notificationMeta";

describe("routeFor", () => {
  it("routes ticket-bearing types to the ticket, registered to pay, else the event", () => {
    expect(routeFor("paid", { registration_id: "r1" })).toBe("/ticket/r1");
    expect(routeFor("checked_in", { registration_id: "r1" })).toBe("/ticket/r1");
    expect(routeFor("registered", { registration_id: "r1" })).toBe("/pay/r1");
    expect(routeFor("event_reminder", { event_id: "e1" })).toBe("/event/e1");
    expect(routeFor("event_created", {})).toBeNull();
  });
});
