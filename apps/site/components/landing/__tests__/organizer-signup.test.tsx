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
  await user.click(screen.getByRole("button", { name: "Send an inquiry" }));
  await user.type(screen.getByLabelText(/First name/), "Ana");
  await user.type(screen.getByLabelText(/Last name/), "Runner");
  await user.type(screen.getByLabelText(/^Email/), "ana@example.com");
  await user.selectOptions(screen.getByLabelText(/reaching out as/), "runner");
  await user.type(screen.getByLabelText(/^Subject/), "Registration payment");
  await user.type(screen.getByLabelText(/^Message/), "Please help me verify my payment.");
  return user;
}

describe("OrganizerSignup", () => {
  it("shows the shared runner and organizer inquiry card", () => {
    render(<OrganizerSignup />);

    expect(screen.getByText("What can we help with?")).toBeInTheDocument();
    expect(screen.getByText("Runner support")).toBeInTheDocument();
    expect(screen.getByText("Organizer access")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send an inquiry" })).toBeInTheDocument();
  });

  it("opens an accessible modal with the requested fields and message limit", async () => {
    const user = userEvent.setup();
    render(<OrganizerSignup />);

    await user.click(screen.getByRole("button", { name: "Send an inquiry" }));

    expect(screen.getByRole("dialog", { name: "How can we help?" })).toBeInTheDocument();
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
    expect(await screen.findByRole("status")).toHaveTextContent("confirmation email is on its way to ana@example.com");
  });

  it("shows a direct contact fallback when delivery fails", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("unavailable") });
    render(<OrganizerSignup />);
    const user = await openAndCompleteForm();
    await user.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("inquiries@racepace.com.ph");
  });
});
