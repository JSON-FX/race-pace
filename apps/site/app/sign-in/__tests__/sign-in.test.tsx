import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SignInForm as SignIn } from "../SignInForm";

// The page is now an async Server Component — it reads the season stats for the
// brand canvas — so these tests target SignInForm, which holds every behaviour
// they assert. Aliased to `SignIn` so the cases below read unchanged.

// vitest.setup.ts's next/navigation mock returns a fresh `replace` fn per
// `useRouter()` call, so there is no stable reference to assert navigation
// against. Override it here with a module-scoped spy the tests can inspect.
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace, refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/",
  redirect: vi.fn(),
}));

const signInWithPassword = vi.fn();
vi.mock("@/lib/auth", () => ({
  signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
  signInWithGoogle: vi.fn(),
}));

beforeEach(() => {
  signInWithPassword.mockReset();
  signInWithPassword.mockResolvedValue({});
  replace.mockClear();
});

describe("SignIn", () => {
  it("submits the trimmed email and password, then navigates to next", async () => {
    render(<SignIn />);
    await userEvent.type(screen.getByLabelText("Email"), "runner@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "hunter2hunter2");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(signInWithPassword).toHaveBeenCalledWith("runner@example.com", "hunter2hunter2");
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("shows the server's error message and does not navigate", async () => {
    signInWithPassword.mockResolvedValue({ error: "Invalid login credentials" });
    render(<SignIn />);
    await userEvent.type(screen.getByLabelText("Email"), "runner@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Invalid login credentials")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("offers Google as an alternative", () => {
    render(<SignIn />);
    expect(screen.getByRole("button", { name: /Continue with Google/ })).toBeInTheDocument();
  });
});
