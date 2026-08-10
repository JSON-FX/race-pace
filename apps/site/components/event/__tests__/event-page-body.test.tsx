import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { EventRow, CategoryRow, AddonRow } from "@/lib/events";
import type { MyEntry } from "@/lib/entry";
import { EventPageBody } from "../EventPageBody";

// The course map pulls in maplibre (WebGL, workers) — neither exists in jsdom,
// and none of these assertions are about the map.
vi.mock("../CourseMap", () => ({ CourseMap: () => null }));

const baseEvent: EventRow = {
  id: "e1", org_id: "a1", name: "Dahilayan Sky Ultra 2026",
  place: "Dahilayan", region: "Northern Mindanao",
  event_date: "2026-11-14", end_date: null, elevation_gain_m: 1223,
  cutoff_hours: 14, flag_off: "04:00:00", status: "open",
  hero_image_url: null, description: "A 60K loop into the Kitanglad range.",
  gallery: [], original_date: null, status_note: null,
  city_psgc_code: "101314000", region_name: "Northern Mindanao",
  province_name: "Bukidnon", city_name: "Manolo Fortich",
  venue: "Dahilayan Adventure Park", inclusions: [],
  joined_count: 18, distances: [60, 30], org_name: "Race Pace",
  discipline: "trail", schedule: [],
  start_lat: null, start_lng: null, finish_lat: null, finish_lng: null, route: null,
};

const cat = (over: Partial<CategoryRow> = {}): CategoryRow => ({
  id: "c1", event_id: "e1", org_id: "a1", code: "60K", label: "60K Ultra",
  distance_km: 60, base_price: 320000, slots_total: 120, slots_taken: 18,
  elevation_gain_m: 1223, cutoff_hours: 14, blurb: "The full Kitanglad loop.",
  ...over,
});

function renderBody(
  event: Partial<EventRow> = {},
  categories = [cat()],
  addons: AddonRow[] = [],
  closed = false,
  myEntry: MyEntry | null = null,
) {
  return render(
    <EventPageBody
      event={{ ...baseEvent, ...event }}
      categories={categories}
      addons={addons}
      closed={closed}
      myEntry={myEntry}
    />,
  );
}

describe("EventPageBody — distances", () => {
  it("renders each distance with its formatted price and a link to /register/<id>", () => {
    renderBody();
    expect(screen.getByText("60K Ultra")).toBeInTheDocument();
    expect(screen.getByText("₱3,200.00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Join 60K Ultra/ })).toHaveAttribute("href", "/register/c1");
  });

  it("does not present a sold-out category as enterable", () => {
    renderBody({}, [cat({ slots_taken: 120 })]);
    expect(screen.getByText("Sold out")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Join/ })).not.toBeInTheDocument();
  });

  it("says registration is closed — not 'sold out' — once the event closes", () => {
    // "Sold out" on a cancelled race sends a runner looking for next year's
    // edition of something that is not running.
    renderBody({ status: "cancelled" }, [cat()], [], true);
    expect(screen.getByText("Registration closed")).toBeInTheDocument();
    expect(screen.queryByText("Sold out")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Join/ })).not.toBeInTheDocument();
  });

  it("does not manufacture urgency when slots are plentiful", () => {
    renderBody({}, [cat({ slots_total: 120, slots_taken: 18 })]);
    // Match the scarcity badge specifically ("5 left"), not the "Slots left"
    // stat label in the hero strip.
    expect(screen.queryByText(/^\d+ left$/)).not.toBeInTheDocument();
  });

  it("flags scarcity only for the category that is actually low", () => {
    renderBody({}, [
      cat({ id: "c1", label: "60K Ultra", slots_total: 120, slots_taken: 115 }),
      cat({ id: "c2", label: "30K", slots_total: 180, slots_taken: 20 }),
    ]);
    expect(screen.getByText("5 left")).toBeInTheDocument();
    expect(screen.queryByText("160 left")).not.toBeInTheDocument();
  });

  it("omits per-category facts that are null rather than printing 0", () => {
    renderBody({}, [cat({ elevation_gain_m: null, cutoff_hours: null, blurb: null })]);
    expect(screen.queryByText(/0 m gain/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0 h cut-off/)).not.toBeInTheDocument();
  });
});

describe("EventPageBody — existing entry", () => {
  const categories = [cat({ id: "c1", label: "60K Ultra" }), cat({ id: "c2", label: "30K" })];

  it("offers a view-entry link, not Join, on the distance the runner is paid into", () => {
    const myEntry: MyEntry = { id: "r1", status: "paid", categoryId: "c1", expiresAt: null };
    renderBody({}, categories, [], false, myEntry);
    expect(screen.getByText("Your entry")).toBeInTheDocument();
    // Name includes the distance — see the a11y test below for why.
    expect(screen.getByRole("link", { name: "You're in — view entry — 60K Ultra" })).toHaveAttribute(
      "href",
      "/races",
    );
  });

  it("offers finish-payment, not Join, on the distance the runner has a pending hold on", () => {
    const myEntry: MyEntry = { id: "r1", status: "pending", categoryId: "c1", expiresAt: "2099-01-01T00:00:00Z" };
    renderBody({}, categories, [], false, myEntry);
    expect(screen.getByText("Payment pending")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Finish payment — 60K Ultra" })).toHaveAttribute(
      "href",
      "/pay/r1",
    );
  });

  it("re-labels a distance the runner did NOT enter too, instead of leaving Join live", () => {
    // One registration is per EVENT, not per distance — every row has to say
    // so, or the other distance walks the runner into a 409.
    const myEntry: MyEntry = { id: "r1", status: "paid", categoryId: "c1", expiresAt: null };
    renderBody({}, categories, [], false, myEntry);
    expect(screen.getByText("Registered — other distance")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Join/ })).not.toBeInTheDocument();
  });

  it("gives every re-labeled row an accessible name that names ITS OWN distance", () => {
    // With two distances re-labeled identically ("Registered — other
    // distance"), a screen reader's link list is otherwise two indistinguishable
    // entries. The visible text can stay generic; the accessible name may not.
    const threeCats = [
      cat({ id: "c1", label: "60K Ultra" }),
      cat({ id: "c2", label: "30K" }),
      cat({ id: "c3", label: "10K" }),
    ];
    const myEntry: MyEntry = { id: "r1", status: "paid", categoryId: "c1", expiresAt: null };
    renderBody({}, threeCats, [], false, myEntry);

    expect(screen.getByRole("link", { name: "30K — you're registered on another distance" })).toHaveAttribute(
      "href",
      "/races",
    );
    expect(screen.getByRole("link", { name: "10K — you're registered on another distance" })).toHaveAttribute(
      "href",
      "/races",
    );
  });

  it("shows Join everywhere when there is no entry — the shape fetchMyEntry returns for an expired hold", () => {
    // The expiry rule itself lives in fetchMyEntry (lib/entry.ts), which
    // returns null for a pending row past its expires_at — this pins what
    // the component does with that null, which is the half of the contract
    // that actually reaches the page.
    renderBody({}, categories, [], false, null);
    expect(screen.getAllByRole("link", { name: /^Join/ })).toHaveLength(2);
    expect(screen.queryByText("Payment pending")).not.toBeInTheDocument();
  });
});

describe("EventPageBody — page-level CTAs (hero + closing band)", () => {
  // Both bands share one `topHref`/`topLabel` computation, so they always
  // agree with each other and with the rows: a runner holding a live entry
  // must never see the page invite them to "Choose your distance" again,
  // in the hero OR in the closing band lower down.
  const categories = [cat({ id: "c1", label: "60K Ultra" }), cat({ id: "c2", label: "30K" })];

  it("points both top-level CTAs at the runner's paid entry instead of #distances", () => {
    const myEntry: MyEntry = { id: "r1", status: "paid", categoryId: "c1", expiresAt: null };
    renderBody({}, categories, [], false, myEntry);

    const links = screen.getAllByRole("link", { name: "View your entry" });
    expect(links).toHaveLength(2); // hero + closing band
    for (const link of links) expect(link).toHaveAttribute("href", "/races");
    expect(screen.queryByRole("link", { name: "Choose your distance" })).not.toBeInTheDocument();
  });

  it("points both top-level CTAs at finishing payment for a pending entry", () => {
    const myEntry: MyEntry = { id: "r1", status: "pending", categoryId: "c1", expiresAt: "2099-01-01T00:00:00Z" };
    renderBody({}, categories, [], false, myEntry);

    const links = screen.getAllByRole("link", { name: "Finish payment" });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute("href", "/pay/r1");
  });

  it("still offers #distances at the top level when there is no entry", () => {
    renderBody({}, categories, [], false, null);
    const links = screen.getAllByRole("link", { name: "Choose your distance" });
    expect(links).toHaveLength(2);
    for (const link of links) expect(link).toHaveAttribute("href", "#distances");
  });

  it("prioritizes the runner's entry over `closed` at the top level, same as the rows do", () => {
    // A completed/cancelled event can still owe a runner a look at the entry
    // they already hold; DistanceRow already puts myEntry ahead of `closed`,
    // and the closing band's own visibility guard (myEntry || !closed) is
    // what lets its CTA survive being closed at all.
    const myEntry: MyEntry = { id: "r1", status: "paid", categoryId: "c1", expiresAt: null };
    renderBody({}, categories, [], true, myEntry);

    const links = screen.getAllByRole("link", { name: "View your entry" });
    expect(links).toHaveLength(2);
    expect(screen.queryByText("See race details")).not.toBeInTheDocument();
    expect(screen.queryByText("Registration is closed")).not.toBeInTheDocument();
  });

  it("still hides the closing band's CTA (but not the hero's) when closed with no entry", () => {
    renderBody({}, categories, [], true, null);
    expect(screen.getByText("See race details")).toBeInTheDocument();
    expect(screen.getByText("Registration is closed")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Choose your distance" })).not.toBeInTheDocument();
  });
});

describe("EventPageBody — discipline branch", () => {
  it("leads with vertical gain on a trail event", () => {
    renderBody({ discipline: "trail" });
    expect(screen.getByText("Vertical gain")).toBeInTheDocument();
    expect(screen.getByText("Pick your suffering")).toBeInTheDocument();
  });

  it("leads with distance on a road event, not gain", () => {
    renderBody({ discipline: "fun_run" });
    expect(screen.getByText("Longest")).toBeInTheDocument();
    expect(screen.getByText("Pick your pace")).toBeInTheDocument();
    expect(screen.queryByText("Vertical gain")).not.toBeInTheDocument();
  });

  it("uses the profile branch for ultra too — the bug hardcoding === 'trail' would cause", () => {
    renderBody({ discipline: "ultra" });
    expect(screen.getByText("Vertical gain")).toBeInTheDocument();
  });

  it("treats a missing discipline as profile, matching disciplineLayout()'s default", () => {
    renderBody({ discipline: null });
    expect(screen.getByText("Vertical gain")).toBeInTheDocument();
  });
});

describe("EventPageBody — sections appear only when they have data", () => {
  it("publishes the race-morning schedule on a TRAIL event", () => {
    renderBody({ discipline: "trail", schedule: [{ time: "04:00", label: "Gun start" }] });
    expect(screen.getByText("Race morning")).toBeInTheDocument();
    expect(screen.getByText("Gun start")).toBeInTheDocument();
  });

  it("publishes the race-morning schedule on a ROAD event too", () => {
    // The admin offers the schedule editor for every discipline; publishing it
    // on one layout only means an organizer's saved timeline goes nowhere.
    renderBody({ discipline: "fun_run", schedule: [{ time: "05:00", label: "Gun start" }] });
    expect(screen.getByText("Race morning")).toBeInTheDocument();
  });

  it("omits the schedule section entirely when empty — the default state", () => {
    renderBody({ schedule: [] });
    expect(screen.queryByText("Race morning")).not.toBeInTheDocument();
  });

  it("shows inclusions when populated and omits the section when not", () => {
    const { unmount } = renderBody({ inclusions: ["Race kit, bib, and timing chip"] });
    expect(screen.getByText("Race kit, bib, and timing chip")).toBeInTheDocument();
    unmount();

    renderBody({ inclusions: [] });
    expect(screen.queryByText("In your entry")).not.toBeInTheDocument();
  });

  it("shows add-ons when there are any, and omits the section when there are none", () => {
    const { unmount } = renderBody({}, [cat()], [{ id: "d1", name: "Event Singlet", price: 60000 }]);
    expect(screen.getByText("Event Singlet")).toBeInTheDocument();
    expect(screen.getByText("+₱600.00")).toBeInTheDocument();
    unmount();

    renderBody({}, [cat()], []);
    expect(screen.queryByText("Make it yours")).not.toBeInTheDocument();
  });

  it("omits the course locator when the event has no coordinates", () => {
    renderBody({ start_lat: null, start_lng: null });
    expect(screen.queryByText("The course")).not.toBeInTheDocument();
  });

  it("omits the gallery when there are no photos", () => {
    renderBody({ gallery: [] });
    expect(screen.queryByText("Last year")).not.toBeInTheDocument();
  });
});

describe("EventPageBody — hero", () => {
  it("renders without a hero image — the fallback path that actually ships", () => {
    renderBody({ hero_image_url: null });
    expect(screen.getByRole("heading", { name: /Dahilayan Sky Ultra 2026/ })).toBeInTheDocument();
  });

  it("points the hero CTA at details rather than entry once closed", () => {
    renderBody({ status: "closed" }, [cat()], [], true);
    expect(screen.getByText("See race details")).toBeInTheDocument();
    expect(screen.queryByText("Choose your distance")).not.toBeInTheDocument();
  });

  it("shows the organizer's status note when one is set", () => {
    renderBody({ status_note: "Rescheduled due to typhoon." });
    expect(screen.getByText("Rescheduled due to typhoon.")).toBeInTheDocument();
  });
});
