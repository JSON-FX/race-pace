import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SiteFooter } from "../SiteFooter";

it("shows QR Ph with the other accepted payment methods", () => {
  render(<SiteFooter />);

  const qrPh = screen.getByRole("img", { name: "QR Ph" });
  expect(qrPh).toBeInTheDocument();
  expect(qrPh).toHaveAttribute("src", "/payments/qr-ph.svg");
  expect(screen.getAllByRole("img").map((image) => image.getAttribute("alt"))).toEqual([
    "Race Pace",
    "GCash",
    "Maya",
    "QR Ph",
    "Visa",
    "Mastercard",
  ]);
});
