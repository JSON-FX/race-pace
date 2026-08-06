import { render, screen, fireEvent } from "@testing-library/react";
import { CategoryEditor } from "./CategoryEditor";
import type { CategoryDraft } from "../lib/actions/events";

const row: CategoryDraft = {
  id: "c1", code: "21k", label: "21K", distance_km: 21, base_price: 150000, slots_total: 100,
  elevation_gain_m: 1200, cutoff_hours: 6.5, blurb: "For experienced trail runners",
};

it("a blank optional category field persists as null, not an empty string", () => {
  const onChange = vi.fn();
  render(<CategoryEditor rows={[row]} onChange={onChange} />);

  fireEvent.change(screen.getByLabelText("Category blurb"), { target: { value: "" } });
  expect(onChange).toHaveBeenLastCalledWith([{ ...row, blurb: null }]);

  fireEvent.change(screen.getByLabelText("Category elevation gain"), { target: { value: "" } });
  expect(onChange).toHaveBeenLastCalledWith([{ ...row, elevation_gain_m: null }]);

  fireEvent.change(screen.getByLabelText("Category cutoff hours"), { target: { value: "" } });
  expect(onChange).toHaveBeenLastCalledWith([{ ...row, cutoff_hours: null }]);
});

it("edits gain, cutoff, and blurb through to onChange", () => {
  const onChange = vi.fn();
  render(<CategoryEditor rows={[{ ...row, elevation_gain_m: null, cutoff_hours: null, blurb: null }]} onChange={onChange} />);

  fireEvent.change(screen.getByLabelText("Category elevation gain"), { target: { value: "3200" } });
  expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ elevation_gain_m: 3200 })]);

  fireEvent.change(screen.getByLabelText("Category cutoff hours"), { target: { value: "18.5" } });
  expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ cutoff_hours: 18.5 })]);

  fireEvent.change(screen.getByLabelText("Category blurb"), { target: { value: "For first-timers" } });
  expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ blurb: "For first-timers" })]);
});
