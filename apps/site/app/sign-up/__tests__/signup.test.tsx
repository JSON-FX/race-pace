import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import SignUp from "../page";
const signup = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();
vi.mock("@/lib/auth", () => ({ signUpWithPassword: (...args: unknown[]) => signup(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh }), useSearchParams: () => new URLSearchParams("next=/races") }));
vi.mock("@/components/GoogleButton", () => ({ GoogleButton: () => null }));
beforeEach(() => vi.clearAllMocks());
async function submit() {
 render(<SignUp />);
 fireEvent.change(screen.getByLabelText("Email"), { target: { value: "runner@example.com" } });
 fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
 fireEvent.click(screen.getByRole("button", { name: "Create account" }));
 await waitFor(() => expect(signup).toHaveBeenCalled());
}
it("keeps confirmation-required signup on check-email instead of protected destination", async () => {
 signup.mockResolvedValue({ confirmationRequired: true });
 await submit();
 expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
 expect(replace).not.toHaveBeenCalled();
});
it("navigates and refreshes when signup returns a session", async () => {
 signup.mockResolvedValue({ confirmationRequired: false });
 await submit();
 await waitFor(() => expect(replace).toHaveBeenCalledWith("/races"));
 expect(refresh).toHaveBeenCalled();
});
