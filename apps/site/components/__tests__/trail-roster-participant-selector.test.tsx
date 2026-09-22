import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TrailRosterParticipantSelector } from "@/components/registration/TrailRosterParticipantSelector";

const passports = [
  { id: "self", name: "Ava Runner", relationship: "Your Race Passport", valid: true },
  { id: "guest", name: "Lola Runner", relationship: "Managed Race Passport", valid: true },
];
const categories = [
  { id: "14k", label: "14K Trail", price: 100000, available: 8 },
  { id: "30k", label: "30K Ultra", price: 180000, available: 2 },
];

describe("TrailRosterParticipantSelector", () => {
  it("keeps selected rows neutral and enables their category selector", () => {
    render(<TrailRosterParticipantSelector passports={passports} categories={categories}
      selections={[{ passportId: "self", categoryId: "14k" }]} onSelectionsChange={vi.fn()} />);
    expect(screen.getByText("Selected")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Category for Ava Runner" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "Category for Lola Runner" })).toBeDisabled();
    expect(screen.getAllByRole("listitem")[0]).not.toHaveClass("bg-primary");
  });

  it("adds an omitted Passport with the first available category", () => {
    const onChange = vi.fn();
    render(<TrailRosterParticipantSelector passports={passports} categories={categories}
      selections={[]} onSelectionsChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Lola Runner" }));
    expect(onChange).toHaveBeenCalledWith([{ passportId: "guest", categoryId: "14k" }]);
  });
});
