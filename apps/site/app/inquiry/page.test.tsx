import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@/components/SiteHeader", () => ({ SiteHeader: () => <header>Site header</header> }));
vi.mock("@/components/landing/OrganizerSignup", () => ({
  OrganizerSignup: () => <form aria-label="Inquiry form" />,
}));

import InquiryPage from "./page";

it("hosts the inquiry form on a dedicated page", () => {
  render(<InquiryPage />);
  expect(screen.getByRole("heading", { name: "Let's clear the way forward." })).toBeInTheDocument();
  expect(screen.getByRole("form", { name: "Inquiry form" })).toBeInTheDocument();
  expect(screen.getByText("Registration, payment, and race-pass support")).toBeInTheDocument();
});
