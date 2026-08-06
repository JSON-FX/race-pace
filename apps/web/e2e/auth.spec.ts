import { test, expect } from "@playwright/test";

const ADMIN = { email: "admin@racepace.test", password: "password123" };

test("an unauthenticated request to a protected route redirects to /login?next=…", async ({ page }) => {
  await page.goto("/registrations");
  await expect(page).toHaveURL(/\/login\?next=%2Fregistrations/);
});

test("a wrong password shows an error and does not navigate", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  // Next's route announcer also carries role="alert" (empty, for SR route
  // changes) — scope to the form's own error paragraph.
  await expect(page.locator("form").getByRole("alert")).toContainText("don't match");
  await expect(page).toHaveURL(/\/login/);
});

test("an admin signs in, sees the shell, and lands on the default /events page", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/events$/);
  await expect(page.getByRole("heading", { name: "Events" })).toBeVisible();
  // The shared chrome from Task 4/V1 — sidebar nav to the other admin pages.
  await expect(page.getByRole("link", { name: /Registrations/ })).toBeVisible();
});

test("signing in returns to the originally requested page via ?next=", async ({ page }) => {
  await page.goto("/login?next=%2Fsettings");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/settings$/);
});

// No non-admin fixture account exists in supabase/seed.sql — only the
// provisioned admin@racepace.test. Wiring this up would mean creating a new
// auth user as part of a test-infra task, which is out of this task's scope.
// Left written-but-skipped (with real selectors, not fabricated) rather than
// silently dropped: set E2E_NONADMIN_EMAIL / E2E_NONADMIN_PASSWORD in the
// environment to exercise it against a seeded non-admin account.
const NONADMIN = process.env.E2E_NONADMIN_EMAIL && process.env.E2E_NONADMIN_PASSWORD
  ? { email: process.env.E2E_NONADMIN_EMAIL, password: process.env.E2E_NONADMIN_PASSWORD }
  : null;

test("a non-admin lands on /no-access", async ({ page }) => {
  test.skip(!NONADMIN, "No E2E_NONADMIN_EMAIL/PASSWORD in the environment — see comment above.");
  await page.goto("/login");
  await page.getByLabel("Email").fill(NONADMIN!.email);
  await page.getByLabel("Password").fill(NONADMIN!.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/no-access$/);
  await expect(page.getByRole("heading", { name: "No admin access" })).toBeVisible();
});
