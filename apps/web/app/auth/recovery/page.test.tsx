import { StrictMode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
const { redeem, auth } = vi.hoisted(() => ({ redeem: vi.fn(), auth: { getUser: vi.fn(), updateUser: vi.fn(), signOut: vi.fn() } }));
vi.mock("@/lib/recovery", () => ({ redeemRecoveryLink: redeem }));
import RecoveryPage from "./page";
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/auth/recovery?code=secret");
  redeem.mockResolvedValue({ client: { auth }, userId: "u" });
  auth.getUser.mockResolvedValue({ data: { user: { id: "u" } }, error: null });
  auth.updateUser.mockResolvedValue({ error: null });
  auth.signOut.mockResolvedValue({ error: null });
});
async function fill(confirm = "newpassword") {
  fireEvent.change(await screen.findByLabelText("New password"), { target: { value: "newpassword" } });
  fireEvent.change(screen.getByLabelText("Confirm new password"), { target: { value: confirm } });
  fireEvent.click(screen.getByRole("button", { name: "Update password" }));
}
it("clears credentials and only enables the form after redemption", async () => {
  render(<RecoveryPage />);
  expect(window.location.search).toBe("");
  await screen.findByLabelText("New password");
  expect(redeem.mock.calls[0][0].searchParams.get("code")).toBe("secret");
});
it("rejects absent/expired link despite any prior session", async () => {
  redeem.mockResolvedValue(null);
  render(<RecoveryPage />);
  await screen.findByText("This reset link is invalid, expired, or already used.");
  expect(screen.queryByLabelText("New password")).toBeNull();
});
it("rejects mismatched passwords without mutation", async () => {
  render(<RecoveryPage />); await fill("different");
  await screen.findByText("Passwords do not match.");
  expect(auth.updateUser).not.toHaveBeenCalled();
});
it("updates the password and signs out", async () => {
  render(<RecoveryPage />); await fill();
  await screen.findByText("Your password has been updated.");
  expect(auth.updateUser).toHaveBeenCalledWith({ password: "newpassword" });
  expect(auth.signOut).toHaveBeenCalledOnce();
});
it("shows update failure without claiming success", async () => {
  auth.updateUser.mockResolvedValue({ error: {} });
  render(<RecoveryPage />); await fill();
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("couldn't update"));
  expect(auth.signOut).not.toHaveBeenCalled();
});

it("refuses an account switched after link verification", async () => {
  auth.getUser.mockResolvedValue({ data: { user: { id: "other" } }, error: null });
  render(<RecoveryPage />); await fill();
  await screen.findByText("This reset link is invalid, expired, or already used.");
  expect(auth.updateUser).not.toHaveBeenCalled();
});

it("redeems only once under StrictMode", async () => {
  render(<StrictMode><RecoveryPage /></StrictMode>);
  await screen.findByLabelText("New password");
  expect(redeem).toHaveBeenCalledOnce();
});
it("handles rejected redemption without leaving a loading screen", async () => {
  redeem.mockRejectedValue(new Error("network"));
  render(<RecoveryPage />);
  await screen.findByText("This reset link is invalid, expired, or already used.");
});

it("reports sign-out failure without claiming the password update failed", async () => {
  auth.signOut.mockResolvedValue({ error: { message: "network" } });
  render(<RecoveryPage />); await fill();
  await screen.findByText("Your password has been updated.");
  expect(screen.getByRole("alert").textContent).toContain("couldn't sign you out");
});
