import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrganizerSignup } from "../OrganizerSignup";

const invoke = vi.fn();
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ functions: { invoke } }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue({ data: { ok: true }, error: null });
});

async function completeForm() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/Your name/), "Ana Runner");
  await user.type(screen.getByLabelText(/Work email/), "ana@example.com");
  await user.type(screen.getByLabelText(/Organization or race name/), "North Ridge Events");
  await user.click(screen.getByRole("button", { name: "Request organizer access" }));
}

describe("OrganizerSignup", () => {
  it("uses a white card with forest-green form styling", () => {
    render(<OrganizerSignup />);

    expect(screen.getByRole("form", { name: "Organizer signup" }).parentElement).toHaveClass(
      "bg-white",
      "text-forest",
    );
    expect(screen.getByText("Your name", { exact: false }).closest("label")).toHaveClass("text-forest/78");
  });

  it("delivers the organizer details through the inquiry function", async () => {
    render(<OrganizerSignup />);
    await completeForm();

    expect(invoke).toHaveBeenCalledWith("organizer-inquiry", {
      body: {
        name: "Ana Runner",
        email: "ana@example.com",
        organization: "North Ridge Events",
        website: "",
      },
    });
    expect(await screen.findByRole("status")).toHaveTextContent("Request sent");
    expect(screen.getByText(/inquiries@racepace.com.ph/)).toBeInTheDocument();
  });

  it("shows a direct contact fallback when delivery fails", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("unavailable") });
    render(<OrganizerSignup />);
    await completeForm();

    expect(await screen.findByRole("alert")).toHaveTextContent("inquiries@racepace.com.ph");
  });
});
