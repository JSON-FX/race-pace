import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { KitStation } from "./station";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  range: vi.fn(),
  invoke: vi.fn(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: mocks.rpc, functions: { invoke: mocks.invoke } }),
}));
const row = {
  registration_id: "reg",
  runner: "QA Runner",
  bib: "QA",
  category: "10K",
  status: "paid",
  kit: { shirt_size: "M", addons: [{ id: "a", name: "Towel" }] },
  release_id: null,
  released_at: null,
  refund_pending: false,
  can_reverse: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rpc.mockReturnValue({ range: mocks.range });
  mocks.range.mockResolvedValue({ data: [row], count: 1 });
});
it("requires runner presence and treats an existing release as a duplicate", async () => {
  mocks.invoke.mockResolvedValue({ data: { ok: true, already: true } });
  render(<KitStation eventId="event" />);
  fireEvent.click(await screen.findByRole("button", { name: "Review kit" }));
  expect(
    screen.getByRole("button", { name: "Release complete kit" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Release complete kit" }));
  expect(
    await screen.findByText(
      "Kit already released. No new release was recorded.",
    ),
  ).toBeInTheDocument();
  expect(mocks.invoke).toHaveBeenCalledWith("kit-release", {
    body: expect.objectContaining({
      event_id: "event",
      registration_id: "reg",
      runner_present: true,
      expected_kit: row.kit,
      request_id: expect.any(String),
    }),
  });
});
it("blocks pending refunds and unpaid entries", async () => {
  mocks.range.mockResolvedValue({
    data: [
      { ...row, refund_pending: true },
      {
        ...row,
        registration_id: "pending",
        runner: "Unpaid",
        status: "pending",
      },
    ],
    count: 2,
  });
  render(<KitStation eventId="event" />);
  await screen.findByText("Refund pending");
  for (const button of screen.getAllByRole("button", { name: "Review kit" }))
    expect(button).toBeDisabled();
});
it("requires a correction reason and preserves errors in the review", async () => {
  mocks.range.mockResolvedValue({
    data: [
      { ...row, release_id: "release", released_at: "2026-09-16T00:00:00Z" },
    ],
    count: 1,
  });
  mocks.invoke.mockResolvedValue({
    error: { context: { json: async () => ({ error: "forbidden" }) } },
  });
  render(<KitStation eventId="event" />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Reverse release" }),
  );
  expect(
    screen.getByRole("button", { name: "Confirm reversal" }),
  ).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Reason for reversal"), {
    target: { value: "Wrong handoff" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Confirm reversal" }));
  await waitFor(() =>
    expect(screen.getByRole("alert")).toHaveTextContent("permission"),
  );
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
