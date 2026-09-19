import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
const resetPasswordForEmail = vi.hoisted(() => vi.fn());
vi.mock("@/lib/recovery", () => ({ createRecoveryClient: () => ({ auth: { resetPasswordForEmail } }) }));
vi.mock("@/components/TurnstileWidget", () => ({
  TurnstileWidget: ({ onTokenChange }: { onTokenChange: (token: string) => void }) => <button type="button" onClick={() => onTokenChange("captcha-token")}>Complete verification</button>,
}));
import ForgotPasswordPage from "./page";
beforeEach(() => { resetPasswordForEmail.mockReset().mockResolvedValue({ error: null }); });
async function submit() {
  render(<ForgotPasswordPage />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "staff@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Complete verification" }));
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
}
it("uses a dedicated recovery destination and non-enumerating feedback", async () => {
  await submit();
  await screen.findByRole("status");
  expect(screen.getByRole("status").textContent).toContain("If an account exists");
  expect(resetPasswordForEmail).toHaveBeenCalledWith("staff@example.com", { redirectTo: `${window.location.origin}/auth/recovery`, captchaToken: "captcha-token" });
});
it("hides provider error details", async () => {
  resetPasswordForEmail.mockResolvedValue({ error: { message: "sensitive provider detail" } });
  await submit();
  expect((await screen.findByRole("alert")).textContent).toBe("We couldn't send the reset email. Please try again shortly.");
});
