import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventCombobox } from "./EventCombobox";
import { vi, it, expect } from "vitest";
it("announces active options, keeps deterministic search and returns focus after keyboard selection", async () => {
  const user = userEvent.setup(); const select = vi.fn();
  render(<EventCombobox label="Switch event" events={[{ id: "a", name: "Alpine Trail" }, { id: "b", name: "Bukidnon Run" }]} value="a" onSelect={select} />);
  const trigger = screen.getByRole("combobox", { name: "Switch event" });
  await user.click(trigger);
  const search = screen.getByRole("combobox", { name: "Search events" });
  await user.type(search, "Bukidnon");
  expect(screen.queryByRole("option", { name: "Alpine Trail" })).not.toBeInTheDocument();
  await waitFor(() => expect(search.getAttribute("aria-activedescendant")).toBeTruthy());
  const active = document.getElementById(search.getAttribute("aria-activedescendant")!);
  expect(active).toHaveTextContent("Bukidnon Run");
  await user.keyboard("{Enter}");
  expect(select).toHaveBeenCalledWith("b");
  await waitFor(() => expect(trigger).toHaveFocus());
});
it("limits a broad search to fifty options without disabling a busy picker", async () => {
  render(<EventCombobox label="Switch event" events={Array.from({ length: 55 }, (_, i) => ({ id: String(i), name: `Trail ${i}` }))} value="0" onSelect={vi.fn()} busy />);
  const trigger = screen.getByRole("combobox", { name: "Switch event" });
  expect(trigger).toHaveAttribute("aria-busy", "true"); expect(trigger).not.toBeDisabled();
  await userEvent.click(trigger);
  expect(screen.getAllByRole("option")).toHaveLength(50);
  expect(screen.getByText(/Showing 50 of 55/)).toBeInTheDocument();
});
