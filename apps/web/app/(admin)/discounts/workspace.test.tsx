import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DiscountsWorkspace } from "./workspace";
import { createDiscounts, searchDiscountPassports } from "@/lib/actions/discounts";

vi.mock("@/lib/actions/discounts", () => ({
  createDiscounts: vi.fn(), setDiscountActive: vi.fn(), searchDiscountPassports: vi.fn(),
}));
const runner = { id: "77777777-7777-4777-8777-777777777777", label: "Alex Runner", email: "alex@example.com" };
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(searchDiscountPassports).mockResolvedValue([]);
  vi.mocked(createDiscounts).mockResolvedValue({ created: 1 });
});

it("finds a runner by email and retains the selected Passport when later results change", async () => {
  vi.mocked(searchDiscountPassports).mockImplementation(async (query) => query === runner.email ? [runner] : []);
  const { container } = render(<DiscountsWorkspace codes={[]} events={[]} categories={[]} passports={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Create discount" }));
  fireEvent.change(screen.getByLabelText("Code type"), { target: { value: "special" } });
  fireEvent.click(screen.getByRole("button", { name: "Assign codes to Passports (optional)" }));
  const search = screen.getByRole("textbox", { name: "Search runners by name, email or Passport ID" });
  fireEvent.change(search, { target: { value: runner.email } });
  const checkbox = await screen.findByRole("checkbox", { name: /Alex Runner alex@example.com/ });
  expect(searchDiscountPassports).toHaveBeenCalledWith(runner.email);
  fireEvent.click(checkbox);
  fireEvent.change(search, { target: { value: "another runner" } });
  await waitFor(() => expect(screen.queryByRole("checkbox", { name: /Alex Runner/ })).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Unassign Alex Runner · alex@example.com" })).toBeInTheDocument();
  expect(container.querySelector('input[name="passports"]')).toHaveValue(runner.id);
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(createDiscounts).toHaveBeenCalledWith(expect.objectContaining({ passport_ids: [runner.id], kind: "special" })));
});

it("shows an email for a runner without a name and the Passport ID when email is absent", async () => {
  vi.mocked(searchDiscountPassports).mockResolvedValue([
    { ...runner, label: "Runner" },
    { id: "88888888-8888-4888-8888-888888888888", label: "Managed Runner", email: null },
  ]);
  render(<DiscountsWorkspace codes={[]} events={[]} categories={[]} passports={[]} />);
  fireEvent.click(screen.getByRole("button", { name: "Create discount" }));
  fireEvent.change(screen.getByLabelText("Code type"), { target: { value: "special" } });
  fireEvent.click(screen.getByRole("button", { name: "Assign codes to Passports (optional)" }));
  expect(await screen.findByRole("checkbox", { name: /Runner alex@example.com/ })).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /Managed Runner 88888888-8888-4888-8888-888888888888/ })).toBeInTheDocument();
});
