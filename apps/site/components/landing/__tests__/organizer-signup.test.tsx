import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrganizerSignup } from "../OrganizerSignup";

const { invoke, getOrganizerInquiryCaptchaToken } = vi.hoisted(() => ({
  invoke: vi.fn(),
  getOrganizerInquiryCaptchaToken: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ functions: { invoke } }),
}));
vi.mock("@/lib/recaptcha", () => ({ getOrganizerInquiryCaptchaToken }));

beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue({ data: { ok: true }, error: null });
  getOrganizerInquiryCaptchaToken.mockResolvedValue("captcha-token");
});

async function openAndCompleteForm() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/First name/), "Ana");
  await user.type(screen.getByLabelText(/Last name/), "Runner");
  await user.type(screen.getByLabelText(/^Email/), "ana@example.com");
  await user.selectOptions(screen.getByLabelText(/reaching out as/), "runner");
  await user.type(screen.getByLabelText(/^Subject/), "Registration payment");
  await user.type(screen.getByLabelText(/^Message/), "Please help me verify my payment.");
  return user;
}

describe("OrganizerSignup", () => {
  it("renders the inquiry fields directly on the dedicated page", () => {
    render(<OrganizerSignup />);

    expect(screen.getByText("What can we help with?")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Inquiry form" })).toBeInTheDocument();
    expect(screen.getByLabelText(/First name/)).toBeRequired();
    expect(screen.getByLabelText(/Last name/)).toBeRequired();
    expect(screen.getByLabelText(/^Email/)).toBeRequired();
    expect(screen.getByLabelText(/reaching out as/)).toBeRequired();
    expect(screen.getByLabelText(/^Subject/)).toBeRequired();
    expect(screen.getByLabelText(/^Message/)).toHaveAttribute("maxlength", "5000");
  });

  it("delivers the inquiry and confirms the acknowledgement email", async () => {
    render(<OrganizerSignup />);
    const user = await openAndCompleteForm();
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(invoke).toHaveBeenCalledWith("organizer-inquiry", {
      body: {
        firstName: "Ana",
        lastName: "Runner",
        email: "ana@example.com",
        audience: "runner",
        subject: "Registration payment",
        message: "Please help me verify my payment.",
        website: "",
        captchaToken: "captcha-token",
      },
    });
    expect(await screen.findByRole("status")).toHaveTextContent("reply to ana@example.com");
    expect(screen.queryByRole("form", { name: "Inquiry form" })).not.toBeInTheDocument();
  });

  it("shows a direct contact fallback when delivery fails", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("unavailable") });
    render(<OrganizerSignup />);
    const user = await openAndCompleteForm();
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("inquiries@racepace.com.ph");
  });
});
