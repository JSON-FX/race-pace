import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TicketPanel } from "./TicketPanel";
import { mapReg } from "@/lib/registration";

const state = vi.hoisted(() => ({ data: null as unknown, refetch: vi.fn() }));
vi.mock("@/lib/registration", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/registration")>(),
  useRegistration: () => ({ data: state.data, isLoading: false, refetch: state.refetch }),
}));
vi.mock("@/lib/profile", () => ({ getProfile: async () => null }));
vi.mock("@/components/TicketCard", () => ({ TicketCard: () => <div data-testid="race-pass">Race pass QR</div> }));
vi.mock("@/components/RaceKitCard", () => ({ RaceKitCard: ({ onChange }: { onChange: () => void }) => <button onClick={onChange}>Change kit size</button> }));
vi.mock("@/components/ShirtSizeSheet", () => ({ ShirtSizeSheet: () => <div>Size editor</div> }));

function show(status: string, token: string | null = "historical-token") {
  state.data = mapReg({ id: "registration-id", status, ticket_token: token, total_amount: 100000 });
  return render(<TicketPanel registrationId="registration-id" userId="runner-id" />);
}
function expectNoPass() {
  expect(screen.queryByTestId("race-pass")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Print/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /kit/ })).not.toBeInTheDocument();
}

beforeEach(() => vi.clearAllMocks());
describe("runner ticket eligibility", () => {
  it.each(["refunded", "cancelled", "expired"])("hides retained and absent tokens for %s registrations", (status) => {
    const first = show(status);
    expect(screen.getByRole("heading", { name: `Registration ${status}` })).toBeInTheDocument();
    expectNoPass();
    expect(screen.queryByRole("link", { name: "Complete payment" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to My Races" })).toHaveAttribute("href", "/races");
    first.unmount();
    show(status, null);
    expectNoPass();
    expect(screen.queryByRole("link", { name: "Complete payment" })).not.toBeInTheDocument();
  });
  it.each([null, "stale-token"])("only offers payment for pending registrations, token=%s", (token) => {
    show("pending", token);
    expectNoPass();
    expect(screen.getByRole("link", { name: "Complete payment" })).toHaveAttribute("href", "/pay/registration-id");
  });
  it("does not ask a paid runner to pay again when the token is missing", () => {
    show("paid", null);
    expectNoPass();
    expect(screen.queryByRole("link", { name: "Complete payment" })).not.toBeInTheDocument();
    expect(screen.getByText(/Your registration is paid/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh ticket" }));
    expect(state.refetch).toHaveBeenCalledOnce();
  });
  it("preserves the paid race pass, print and kit editor", () => {
    show("paid");
    expect(screen.getByTestId("race-pass")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Print/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change kit size" }));
    expect(screen.getByText("Size editor")).toBeInTheDocument();
  });
  it("does not turn an unknown status into a race pass or payment invitation", () => {
    show("unknown");
    expectNoPass();
    expect(screen.getByRole("heading", { name: "Ticket unavailable" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Complete payment" })).not.toBeInTheDocument();
  });
});
