import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CheckInQueueStatus } from "../components/CheckInQueueStatus";
import type { FailedScan, QueuedScan } from "../lib/checkinQueue";

const queued = (over: Partial<QueuedScan> = {}): QueuedScan => ({
  clientId: "c1", ticketToken: "tok1", registrationId: "r1",
  runner: "Ana Cruz", category: "10K", scannedAt: "2026-08-06T01:00:00Z", ...over,
});

const failed = (over: Partial<FailedScan> = {}): FailedScan => ({
  ...queued(), reason: "Not paid", httpStatus: 409, failedAt: "2026-08-06T02:00:00Z", ...over,
});

it("renders nothing when there is nothing queued or failed", () => {
  const { container } = render(
    <CheckInQueueStatus queue={[]} failed={[]} online={true} onRetryAll={vi.fn()} onRetryOne={vi.fn()} />,
  );
  expect(container).toBeEmptyDOMElement();
});

it("shows the pending-sync banner once anything is queued", () => {
  render(
    <CheckInQueueStatus queue={[queued()]} failed={[]} online={true} onRetryAll={vi.fn()} onRetryOne={vi.fn()} />,
  );
  expect(screen.getByText(/waiting to sync/i)).toBeInTheDocument();
});

it("surfaces a failed scan loudly, by runner name and reason", () => {
  render(
    <CheckInQueueStatus
      queue={[]} failed={[failed({ runner: "Ben Reyes", category: "21K", reason: "Not paid" })]}
      online={true} onRetryAll={vi.fn()} onRetryOne={vi.fn()}
    />,
  );
  expect(screen.getByText(/needs attention/i)).toBeInTheDocument();
  expect(screen.getByText("Ben Reyes")).toBeInTheDocument();
  expect(screen.getByText(/Not paid/)).toBeInTheDocument();
  expect(screen.getByText(/21K/)).toBeInTheDocument();
});

it("retries the correct failed entry by clientId, not just the first one", async () => {
  const user = userEvent.setup();
  const onRetryOne = vi.fn();
  render(
    <CheckInQueueStatus
      queue={[]}
      failed={[
        failed({ clientId: "c1", runner: "Ana Cruz" }),
        failed({ clientId: "c2", runner: "Ben Reyes" }),
      ]}
      online={true} onRetryAll={vi.fn()} onRetryOne={onRetryOne}
    />,
  );

  const retryButtons = screen.getAllByRole("button", { name: /retry/i });
  expect(retryButtons).toHaveLength(2);
  await user.click(retryButtons[1]!);

  expect(onRetryOne).toHaveBeenCalledTimes(1);
  expect(onRetryOne).toHaveBeenCalledWith("c2");
});

it("hides the sync-now action while offline, since there is nothing to send", () => {
  render(
    <CheckInQueueStatus queue={[queued()]} failed={[]} online={false} onRetryAll={vi.fn()} onRetryOne={vi.fn()} />,
  );
  expect(screen.queryByRole("button", { name: /sync now/i })).not.toBeInTheDocument();
});
