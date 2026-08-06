import { test, expect } from "@playwright/test";

const ADMIN = { email: "admin@racepace.test", password: "password123" };

test.beforeEach(async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/events$/);
});

// The Events table (not Registrations) is the target here on purpose:
// Registrations requires picking an event first via ?event=, which would
// entangle this suite's URL assertions with seed data (which event sorts
// first). Events has no such prerequisite and carries the same DataTable
// (Task 5) underneath, so it exercises the identical filter/pagination code.

test("applying a filter updates the URL, changes the row count, and survives a hard reload", async ({ page }) => {
  const unfiltered = await page.getByRole("status").textContent();

  await page.getByLabel("Status").click();
  await page.getByRole("option", { name: "Cancelled" }).click();
  await expect(page).toHaveURL(/status=cancelled/);

  const filtered = await page.getByRole("status").textContent();
  expect(filtered).not.toBe(unfiltered);

  await page.reload();
  await expect(page).toHaveURL(/status=cancelled/);
  await expect(page.getByRole("status")).toHaveText(filtered!);
});

test("the browser Back button restores the previous filter state", async ({ page }) => {
  const unfiltered = await page.getByRole("status").textContent();

  await page.getByLabel("Status").click();
  await page.getByRole("option", { name: "Cancelled" }).click();
  await expect(page).toHaveURL(/status=cancelled/);

  await page.goBack();
  await expect(page).not.toHaveURL(/status=cancelled/);
  // Back re-renders the table via a soft navigation; give the RSC payload a
  // beat before asserting on content, same as the reload case above.
  await expect(page.getByRole("status")).toHaveText(unfiltered!, { timeout: 10_000 });
});

test("a removable chip clears its filter", async ({ page }) => {
  await page.goto("/events?status=cancelled");
  await expect(page.getByLabel("Remove Status filter")).toBeVisible();
  await page.getByLabel("Remove Status filter").click();
  await expect(page).not.toHaveURL(/status=cancelled/);
});

test("changing rows per page updates the URL and the range label", async ({ page }) => {
  await page.getByLabel("Rows per page").click();
  await page.getByRole("option", { name: "50", exact: true }).click();
  await expect(page).toHaveURL(/per=50/);
  // rangeLabel (lib/table-params.ts) renders "a–b of N".
  await expect(page.getByText(/of \d+$/)).toBeVisible();
});
