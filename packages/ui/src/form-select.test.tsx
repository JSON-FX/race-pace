import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import userEvent from "@testing-library/user-event";
import { FormSelect } from "./form-select";
import { FieldFrame } from "./field-frame";
import { DatePicker } from "./date-picker";

function Details() {
  const [size, setSize] = useState("");
  return <form aria-label="Details"><FieldFrame label="Shirt size" required hint="Choose a size">
    <FormSelect name="shirt_size" value={size} onChange={event => setSize(event.target.value)}>
      <option value="">Not provided</option><optgroup label="Sizes"><option value="S">Small</option><option value="M">Medium</option></optgroup>
    </FormSelect>
  </FieldFrame></form>;
}
describe("Styled native form enhancement", () => {
  it("keeps a usable required native select in server HTML", () => {
    const html = renderToString(<FormSelect name="size" required defaultValue="M"><option value="M">Medium</option></FormSelect>);
    const birthday = renderToString(<DatePicker id="birthday" name="birthday" required value="" onValueChange={() => {}} />);
    expect(birthday).toContain('type="date"'); expect(birthday).toContain('name="birthday"'); expect(birthday).not.toContain('sr-only');
    expect(html).toContain('<select'); expect(html).toContain('name="size"'); expect(html).toContain('required'); expect(html).not.toContain('sr-only');
  });
  it("changes the real form value, preserves empty choices, and links the visible label", async () => {
    render(<Details />); const user = userEvent.setup();
    const trigger = screen.getByRole("combobox", { name: "Shirt size" });
    expect(trigger).toHaveAccessibleDescription("Choose a size");
    await user.click(trigger); await user.click(screen.getByRole("option", { name: "Medium" }));
    const form = screen.getByRole("form", { name: "Details" }) as HTMLFormElement;
    expect(new FormData(form).get("shirt_size")).toBe("M");
    await user.click(trigger); await user.click(screen.getByRole("option", { name: "Not provided" }));
    expect(new FormData(form).get("shirt_size")).toBe("");
    expect(form.checkValidity()).toBe(false); expect(trigger).toHaveFocus();
  });
  it("keeps an implicit wrapping label on the visible control", () => {
    render(<label>Meal preference<FormSelect name="meal"><option value="standard">Standard</option></FormSelect></label>);
    expect(screen.getByRole("combobox", { name: /Meal preference/ })).toBeInTheDocument();
  });
  it("resets uncontrolled form values and exposes disabled state", async () => {
    render(<form aria-label="Reset"><FormSelect name="size" defaultValue="S" aria-label="Size"><option value="S">Small</option><option value="M">Medium</option></FormSelect><FormSelect disabled aria-label="Disabled"><option>No choice</option></FormSelect></form>);
    const user = userEvent.setup(); const trigger = screen.getByRole("combobox", { name: "Size" });
    await user.click(trigger); await user.click(screen.getByRole("option", { name: "Medium" }));
    const form = screen.getByRole("form", { name: "Reset" }) as HTMLFormElement;
    fireEvent.reset(form);
    await waitFor(() => expect(new FormData(form).get("size")).toBe("S"));
    expect(screen.getByRole("combobox", { name: "Disabled" })).toBeDisabled();
  });
  it("uses a calendar and preserves civil dates, bounds, keyboard dismissal and labels", async () => {
    const onValueChange = vi.fn();
    render(<form aria-label="Birthday"><FieldFrame label="Birthday" required error="Required"><DatePicker name="birthday" value="1950-01-01" max="2026-09-27" onValueChange={onValueChange} /></FieldFrame></form>);
    const user = userEvent.setup(); const trigger = screen.getByRole("button", { name: "Birthday" });
    expect(trigger).toHaveAccessibleDescription("Required");
    expect(new FormData(screen.getByRole("form", { name: "Birthday" }) as HTMLFormElement).get("birthday")).toBe("1950-01-01");
    await user.click(trigger);
    expect(screen.getByRole("grid")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /January 2nd, 1950/ }));
    expect(onValueChange).toHaveBeenCalledWith("1950-01-02");
    await user.click(trigger); await user.keyboard("{Escape}");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
  });
});
