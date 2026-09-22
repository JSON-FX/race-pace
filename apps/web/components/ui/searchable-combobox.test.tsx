import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SearchableCombobox } from "./searchable-combobox";

const options = [
  {
    value: "yalabyalam",
    label: "Yalabyalam Backyard Ultra",
    description: "Oct 18, 2026 · Impasug-ong",
    keywords: ["Bukidnon"],
    badge: "Open",
  },
  {
    value: "kulago",
    label: "Mt. Kulago Trail Challenge",
    description: "Feb 7, 2027 · Malaybalay",
    keywords: ["mountain"],
  },
];

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState("");
  return (
    <form data-testid="form">
      <SearchableCombobox
        options={options}
        value={value}
        onValueChange={setValue}
        name="eventId"
        ariaLabel="Event"
        placeholder="Search or choose an event"
        searchPlaceholder="Search events…"
        disabled={disabled}
        required
      />
    </form>
  );
}

describe("SearchableCombobox", () => {
  it("filters metadata and submits the selected value through its form field", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("combobox", { name: "Event" }));
    const search = screen.getByRole("combobox", { name: "Search events…" });
    await user.type(search, "Bukidnon");

    expect(screen.getByText("Yalabyalam Backyard Ultra")).toBeInTheDocument();
    expect(screen.queryByText("Mt. Kulago Trail Challenge")).not.toBeInTheDocument();

    await user.click(screen.getByText("Yalabyalam Backyard Ultra"));
    expect(screen.getByRole("combobox", { name: "Event" })).toHaveTextContent("Yalabyalam Backyard Ultra");

    const form = screen.getByTestId("form") as HTMLFormElement;
    expect(new FormData(form).get("eventId")).toBe("yalabyalam");
  });

  it("shows an empty state for an unmatched search", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("combobox", { name: "Event" }));
    await user.type(screen.getByRole("combobox", { name: "Search events…" }), "road marathon");

    expect(screen.getByText("No matching results.")).toBeInTheDocument();
  });

  it("does not open while disabled", () => {
    render(<Harness disabled />);
    const trigger = screen.getByRole("combobox", { name: "Event" });

    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(screen.queryByRole("combobox", { name: "Search events…" })).not.toBeInTheDocument();
  });

  it("reports changes without requiring a form field", async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    render(
      <SearchableCombobox
        options={options}
        value=""
        onValueChange={onValueChange}
        ariaLabel="Standalone picker"
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Standalone picker" }));
    const list = screen.getByRole("listbox");
    await user.click(within(list).getByText("Mt. Kulago Trail Challenge"));

    expect(onValueChange).toHaveBeenCalledWith("kulago");
  });
});
