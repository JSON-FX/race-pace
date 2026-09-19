import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ functions: { invoke } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { NewOrgDialog } from "./new-org-dialog";

describe("NewOrgDialog", () => {
  beforeEach(() => invoke.mockReset());

  // The database default on organizations.commission_rate is 0.03. The form
  // used to open at 10%, so every org provisioned through the console
  // contradicted the schema's own default.
  it("opens at 3%", async () => {
    const user = userEvent.setup();
    render(<NewOrgDialog />);
    await user.click(screen.getByRole("button", { name: /new organization/i }));
    expect(screen.getByLabelText(/rate/i)).toHaveValue(3);
  });

  it("submits an explicitly entered zero percent for a pilot organizer", async () => {
    invoke.mockImplementation((_name, options) => options?.body?.action === "check_slug"
      ? Promise.resolve({ data: { available: true }, error: null })
      : Promise.resolve({ data: { org: { name: "Pilot organizer" }, invite_link: null }, error: null }));

    const user = userEvent.setup();
    render(<NewOrgDialog />);
    await user.click(screen.getByRole("button", { name: /new organization/i }));
    await user.type(screen.getByLabelText("Name"), "Pilot organizer");
    await user.type(screen.getByLabelText("First admin"), "qa@example.com");
    await user.clear(screen.getByLabelText(/rate/i));
    await user.type(screen.getByLabelText(/rate/i), "0");
    expect(screen.getByText(/commission is zero/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /create and invite/i }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("org-provision", expect.objectContaining({
      body: expect.objectContaining({ action: "create", commission_type: "percent", commission_rate: 0 }),
    })));
  });

  it("shows a connection error when a function fetch fails without a Response context", async () => {
    invoke.mockImplementation((_name, options) => options?.body?.action === "check_slug"
      ? Promise.resolve({ data: { available: true }, error: null })
      : Promise.resolve({
        data: null,
        error: { name: "FunctionsFetchError", context: new TypeError("Failed to fetch") },
      }));

    const user = userEvent.setup();
    render(<NewOrgDialog />);
    await user.click(screen.getByRole("button", { name: /new organization/i }));
    await user.type(screen.getByLabelText("Name"), "Staging QA Organizer");
    await user.type(screen.getByLabelText("First admin"), "qa@example.com");
    await user.click(screen.getByRole("button", { name: /create and invite/i }));

    expect(await screen.findByText(/couldn't reach the organization service/i)).toBeInTheDocument();
  });

  it("reports a delivered sign-in email for an existing admin account", async () => {
    invoke.mockImplementation((_name, options) => options?.body?.action === "check_slug"
      ? Promise.resolve({ data: { available: true }, error: null })
      : Promise.resolve({
        data: { org: { name: "Pilot organizer" }, delivery: "sent", invite_link: "https://admin.example/invite" },
        error: null,
      }));

    const user = userEvent.setup();
    render(<NewOrgDialog />);
    await user.click(screen.getByRole("button", { name: /new organization/i }));
    await user.type(screen.getByLabelText("Name"), "Pilot organizer");
    await user.type(screen.getByLabelText("First admin"), "support.racepace@gmail.com");
    await user.click(screen.getByRole("button", { name: /create and invite/i }));

    expect(await screen.findByText(/a sign-in email was sent/i)).toBeInTheDocument();
  });

  it("shows the manual link when admin email delivery fails", async () => {
    invoke.mockImplementation((_name, options) => options?.body?.action === "check_slug"
      ? Promise.resolve({ data: { available: true }, error: null })
      : Promise.resolve({
        data: { org: { name: "Pilot organizer" }, delivery: "failed", invite_link: "https://admin.example/invite" },
        error: null,
      }));

    const user = userEvent.setup();
    render(<NewOrgDialog />);
    await user.click(screen.getByRole("button", { name: /new organization/i }));
    await user.type(screen.getByLabelText("Name"), "Pilot organizer");
    await user.type(screen.getByLabelText("First admin"), "support.racepace@gmail.com");
    await user.click(screen.getByRole("button", { name: /create and invite/i }));

    expect(await screen.findByText(/email delivery failed/i)).toBeInTheDocument();
    expect(screen.getByText("https://admin.example/invite")).toBeInTheDocument();
  });
});
