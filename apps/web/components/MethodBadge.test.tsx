import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MethodBadge, methodFilterOptions, methodPresentation } from "./MethodBadge";

describe("methodPresentation", () => {
  it("maps each instrument our own code writes to its marks and label", () => {
    expect(methodPresentation("gcash")).toEqual({ kind: "known", label: "GCash", marks: ["gcash"] });
    expect(methodPresentation("paymaya")).toEqual({ kind: "known", label: "Maya", marks: ["maya"] });
  });

  // Not cosmetic: "Card" alone doesn't tell an organizer whether a runner's
  // Visa was accepted, so a card row carries BOTH scheme marks — the same
  // choice apps/site/components/PaymentLogos.tsx and mobile make.
  it("shows both scheme marks for a card payment", () => {
    expect(methodPresentation("card")).toEqual({
      kind: "known", label: "Card", marks: ["visa", "mastercard"],
    });
  });

  // The single most important case. Before the payment-verify fix,
  // confirmations through the redirect path stored the literal "paymongo" —
  // the PROVIDER, not the instrument — and the backfill migration
  // (20260807090500) deliberately leaves rows whose raw payload can't be
  // recovered still reading "paymongo". If that ever renders as a card, the
  // table states a fact about a runner's payment that nobody actually knows.
  it("renders the legacy \"paymongo\" value as unknown, never as a card", () => {
    const p = methodPresentation("paymongo");
    expect(p.kind).toBe("unknown");
    expect(p.marks).toEqual([]);
    expect(p.label).toBe("Unknown");
  });

  // PayMongo can add instruments (pmMethodFromAttributes stores source.type
  // verbatim — an external value this repo does not control). An unrecognised
  // string must show what PayMongo actually said rather than being dropped.
  it("passes an unrecognised instrument through as its own label, with no mark", () => {
    expect(methodPresentation("grab_pay")).toEqual({ kind: "unknown", label: "grab_pay", marks: [] });
  });

  it("normalises case and surrounding whitespace", () => {
    expect(methodPresentation(" GCash ")).toEqual({ kind: "known", label: "GCash", marks: ["gcash"] });
  });

  // A pending/failed row has no method. A blank cell reads as a rendering bug;
  // "Not yet paid" states the actual fact.
  it("renders an unpaid row as \"Not yet paid\", not a blank cell", () => {
    for (const empty of [null, undefined, "", "   "]) {
      expect(methodPresentation(empty)).toEqual({ kind: "unpaid", label: "Not yet paid", marks: [] });
    }
  });
});

describe("methodFilterOptions", () => {
  it("builds options from the distinct values actually present, dropping empties", () => {
    expect(methodFilterOptions(["gcash", "gcash", null, "card", "", "paymaya"])).toEqual([
      { value: "gcash", label: "GCash" },
      { value: "card", label: "Card" },
      { value: "paymaya", label: "Maya" },
    ]);
  });

  it("offers an instrument this code has never heard of, so a new PayMongo method is still filterable", () => {
    expect(methodFilterOptions(["grab_pay"])).toEqual([{ value: "grab_pay", label: "grab_pay" }]);
  });

  it("keeps the unknown legacy bucket, and puts it last", () => {
    expect(methodFilterOptions(["paymongo", "gcash"])).toEqual([
      { value: "gcash", label: "GCash" },
      { value: "paymongo", label: "Unknown" },
    ]);
  });

  it("returns nothing when no payment has a method yet", () => {
    expect(methodFilterOptions([null, "", undefined])).toEqual([]);
  });
});

describe("MethodBadge", () => {
  it("labels the method as text", () => {
    render(<MethodBadge method="gcash" />);
    expect(screen.getByText("GCash")).toBeInTheDocument();
  });

  // The label is already text beside the mark; an alt here would make a screen
  // reader announce "GCash GCash". Same reasoning as PaymentLogos.tsx.
  it("does not repeat the provider name as the image's accessible name", () => {
    const { container } = render(<MethodBadge method="gcash" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("aria-hidden", "true");
  });

  // The PNGs ship their own rounded plates. A CSS chip here would draw a
  // second frame around the one already in the artwork.
  it("puts no border, background or radius on the mark", () => {
    const { container } = render(<MethodBadge method="gcash" />);
    const img = container.querySelector("img")!;
    expect(img.className).not.toMatch(/border|bg-|rounded/);
  });

  it("renders both scheme marks for a card row", () => {
    const { container } = render(<MethodBadge method="card" />);
    expect(container.querySelectorAll("img")).toHaveLength(2);
    expect(screen.getByText("Card")).toBeInTheDocument();
  });

  it("renders no mark at all for an unknown or unpaid row", () => {
    const unknown = render(<MethodBadge method="paymongo" />);
    expect(unknown.container.querySelectorAll("img")).toHaveLength(0);
    expect(screen.getByText("Unknown")).toBeInTheDocument();

    const unpaid = render(<MethodBadge method={null} />);
    expect(unpaid.container.querySelectorAll("img")).toHaveLength(0);
    expect(screen.getByText("Not yet paid")).toBeInTheDocument();
  });
});
