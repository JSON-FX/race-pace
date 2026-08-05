import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SignIn from "../page";

const signInWithPassword = vi.fn();
vi.mock("@/lib/auth", () => ({
  signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
  signInWithGoogle: vi.fn(),
}));

beforeEach(() => {
  signInWithPassword.mockReset();
  signInWithPassword.mockResolvedValue({});
});

describe("SignIn", () => {
  it("submits the trimmed email and password", async () => {
    render(<SignIn />);
    await userEvent.type(screen.getByLabelText("Email"), "runner@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "hunter2hunter2");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(signInWithPassword).toHaveBeenCalledWith("runner@example.com", "hunter2hunter2");
  });

  it("shows the server's error message and does not navigate", async () => {
    signInWithPassword.mockResolvedValue({ error: "Invalid login credentials" });
    render(<SignIn />);
    await userEvent.type(screen.getByLabelText("Email"), "runner@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid login credentials")).toBeInTheDocument();
  });

  it("offers Google as an alternative", () => {
    render(<SignIn />);
    expect(screen.getByRole("button", { name: /Continue with Google/ })).toBeInTheDocument();
  });
});
