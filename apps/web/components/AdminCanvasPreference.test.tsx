import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AdminCanvasController, AdminCanvasPreference } from "./AdminCanvasPreference";

beforeEach(() => {
  localStorage.removeItem("racepace-admin-canvas");
  delete document.documentElement.dataset.adminCanvas;
});

it("defaults to white and saves a choice for every admin page", async () => {
  const { unmount } = render(<><AdminCanvasController /><AdminCanvasPreference /></>);
  await waitFor(() => expect(document.documentElement.dataset.adminCanvas).toBe("white"));
  fireEvent.click(screen.getByRole("button", { name: "Fieldnotes" }));
  expect(localStorage.getItem("racepace-admin-canvas")).toBe("fieldnotes");
  expect(document.documentElement.dataset.adminCanvas).toBe("fieldnotes");
  unmount();
  delete document.documentElement.dataset.adminCanvas;
  render(<AdminCanvasController />);
  await waitFor(() => expect(document.documentElement.dataset.adminCanvas).toBe("fieldnotes"));
});
