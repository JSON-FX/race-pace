import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CancelModal } from "@/components/CancelModal";

const mockCancel = vi.fn().mockResolvedValue({});
vi.mock("@/lib/actions/events", () => ({ cancelEventAction: (id: string, note: string) => mockCancel(id, note) }));

it("cancel modal calls cancelEventAction then onDone", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn(), onDone = vi.fn();
  render(<CancelModal event={{ id: "e1", name: "Apo Sky Ultra" }} onClose={onClose} onDone={onDone} />);
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(/Cancel “Apo Sky Ultra”/)).toBeInTheDocument();
  await user.type(within(dialog).getByLabelText("Cancel note"), "weather");
  await user.click(within(dialog).getByText("Cancel event"));
  await waitFor(() => expect(mockCancel).toHaveBeenCalledWith("e1", "weather"));
  expect(onDone).toHaveBeenCalled();
});
