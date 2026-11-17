import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const actions = vi.hoisted(() => ({ search: vi.fn(), grant: vi.fn(), list: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: actions.push, refresh: actions.refresh }) }));
vi.mock("@/lib/actions/pay-later", () => ({ searchPayLaterRunnersAction: actions.search, grantPayLaterAction: actions.grant, listPayLaterGrantsAction: actions.list }));
vi.mock("@race-pace/ui", () => ({ DatePicker: ({ value, onValueChange, ...props }: { value: string; onValueChange: (value: string) => void }) => <input {...props} type="date" value={value} onChange={event => onValueChange(event.target.value)} /> }));
import { PayLaterManager } from "./pay-later-manager";
import type { PayLaterGrant } from "@/lib/pay-later";
const event = { id: "event-1", name: "Ridge Run", event_date: "2027-03-21", status: "open" };
const runner = { user_id: "runner-1", full_name: "Juan Dela Cruz", email: "juan@example.test" };
const record: PayLaterGrant = {
  ...runner, id: "grant-1", org_id: "org-1", event_id: event.id, due_date: "2027-02-20", due_at: "2027-02-20T16:00:00Z", created_at: "2026-11-18T00:00:00Z",
  registration_id: null, registration_status: null, category_label: null, total_amount: null, payment_status: null, paid_at: null, paid_with_pay_later: false,
};
function setup(overrides = {}) {
  return render(<PayLaterManager events={[event]} event={event} initialPage={{ rows: [], total: 0 }} initialError="" today="2026-11-18" {...overrides} />);
}
beforeEach(() => {
  vi.clearAllMocks();
  actions.search.mockResolvedValue({ ok: true, data: [runner] });
  actions.grant.mockResolvedValue({ ok: true, data: record });
  actions.list.mockResolvedValue({ ok: true, data: { rows: [record], total: 1 } });
});
describe("Pay Later manager", () => {
  it("requires runner selection, reviews event terms, and displays the authoritative existing deadline", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Grant Pay Later" }));
    fireEvent.click(screen.getByRole("button", { name: "Review grant" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Select a runner");
    fireEvent.change(screen.getByLabelText("Runner account"), { target: { value: "Juan" } });
    fireEvent.click(await screen.findByRole("button", { name: /Juan Dela Cruz/ }));
    expect(screen.getByLabelText("Payment due date")).toHaveValue("2027-02-21");
    fireEvent.click(screen.getByRole("button", { name: "Review grant" }));
    expect(screen.getByText(/separate approval before reservation/)).toBeVisible();
    expect(actions.grant).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm eligibility" }));
    expect(await screen.findByText("Pay Later access confirmed.")).toBeVisible();
    expect(actions.grant).toHaveBeenCalledWith({ eventId: "event-1", runnerId: "runner-1", dueDate: "2027-02-21" });
    expect(within(screen.getByRole("dialog")).getByText(/February 20, 2027/)).toBeVisible();
  });
  it("disables new grants when no future date remains while preserving record access", () => {
    setup({ event: { ...event, event_date: "2026-11-19" }, initialPage: { rows: [record], total: 1 } });
    expect(screen.getByRole("button", { name: "Grant Pay Later" })).toBeDisabled();
    expect(screen.getByText("No future payment date remains before event day.")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "View record" }));
    expect(screen.getByRole("dialog")).toBeVisible();
  });
  it("shows roster failure as an error with retry rather than an empty roster", async () => {
    setup({ initialError: "Pay Later approvals could not be loaded." });
    expect(screen.queryByText("No approvals for this event.")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getByText("Juan Dela Cruz")).toBeVisible());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("keeps a pending grant open and prevents duplicate submissions", async () => {
    let resolve!: (value: unknown) => void;
    actions.grant.mockImplementation(() => new Promise(done => { resolve = done; }));
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Grant Pay Later" }));
    fireEvent.change(screen.getByLabelText("Runner account"), { target: { value: "Juan" } });
    fireEvent.click(await screen.findByRole("button", { name: /Juan Dela Cruz/ }));
    fireEvent.click(screen.getByRole("button", { name: "Review grant" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm eligibility" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
    expect(actions.grant).toHaveBeenCalledTimes(1);
    resolve({ ok: true, data: record });
    expect(await screen.findByText("Pay Later access confirmed.")).toBeVisible();
  });
  it("shows a database rejection without confirming a grant", async () => {
    actions.grant.mockResolvedValue({ ok: false, error: "This runner already has a registration." });
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Grant Pay Later" }));
    fireEvent.change(screen.getByLabelText("Runner account"), { target: { value: runner.email } });
    fireEvent.click(await screen.findByRole("button", { name: /Juan Dela Cruz/ }));
    fireEvent.click(screen.getByRole("button", { name: "Review grant" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm eligibility" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already has a registration");
    expect(screen.queryByText("Pay Later access confirmed.")).not.toBeInTheDocument();
  });
});
