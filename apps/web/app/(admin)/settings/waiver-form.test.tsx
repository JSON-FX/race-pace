import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { WaiverForm } from "./waiver-form";

const { publishWaiverAction, selectEventWaiverAction } = vi.hoisted(() => ({
  publishWaiverAction: vi.fn(async (_previous: unknown, _formData: FormData) => ({})),
  selectEventWaiverAction: vi.fn(async (_previous: unknown, _formData: FormData) => ({})),
}));

vi.mock("@/lib/actions/waivers", () => ({ publishWaiverAction, selectEventWaiverAction }));

beforeEach(() => {
  publishWaiverAction.mockClear();
  selectEventWaiverAction.mockClear();
});

it("requires review again whenever the document changes", () => {
  render(<WaiverForm orgId="org" versions={[]} canEdit />);
  const publish = screen.getByRole("button", { name: "Publish waiver version" });
  expect(publish).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/^Version title/), { target: { value: "Waiver" } });
  fireEvent.change(screen.getByLabelText("Waiver text"), { target: { value: "First version" } });
  fireEvent.click(screen.getByRole("checkbox"));
  expect(publish).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Waiver text"), { target: { value: "Changed version" } });
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(publish).toBeDisabled();
});

it("shows published history without publication controls for non-admins", () => {
  render(
    <WaiverForm
      orgId="org"
      canEdit={false}
      versions={[{ id: "v", title: "Published waiver", body: "Exact original text", published_at: "2026-09-16T00:00:00Z" }]}
    />,
  );
  expect(screen.queryByRole("button", { name: "Publish waiver version" })).not.toBeInTheDocument();
  expect(screen.getByText("Exact original text")).toBeInTheDocument();
});

it("searches event and waiver popovers and keeps the Server Action field contract", async () => {
  const user = userEvent.setup();
  render(
    <WaiverForm
      orgId="11111111-1111-4111-8111-111111111111"
      canEdit
      events={[
        { id: "22222222-2222-4222-8222-222222222222", name: "Yalabyalam Backyard Ultra", waiver_version_id: null },
        { id: "33333333-3333-4333-8333-333333333333", name: "Mt. Kulago Trail Challenge", waiver_version_id: null },
      ]}
      versions={[
        { id: "44444444-4444-4444-8444-444444444444", title: "2026 standard waiver", body: "Current", published_at: "2026-09-16T00:00:00Z" },
        { id: "55555555-5555-4555-8555-555555555555", title: "2025 participant waiver", body: "Older", published_at: "2025-12-12T00:00:00Z" },
      ]}
    />,
  );

  await user.click(screen.getByRole("combobox", { name: "Event" }));
  await user.type(screen.getByRole("combobox", { name: "Search events…" }), "Kulago");
  await user.click(screen.getByText("Mt. Kulago Trail Challenge"));

  await user.click(screen.getByRole("combobox", { name: "Published waiver" }));
  await user.type(screen.getByRole("combobox", { name: "Search published waivers…" }), "2025");
  await user.click(screen.getByRole("option", { name: /2025 participant waiver/ }));

  await user.click(screen.getByRole("button", { name: "Use waiver for event" }));

  await waitFor(() => expect(selectEventWaiverAction).toHaveBeenCalled());
  const submitted = selectEventWaiverAction.mock.calls.at(-1)?.[1] as FormData;
  expect(submitted.get("eventId")).toBe("33333333-3333-4333-8333-333333333333");
  expect(submitted.get("waiverId")).toBe("55555555-5555-4555-8555-555555555555");
});
