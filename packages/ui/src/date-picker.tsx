"use client";

import * as React from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "./ui/button";
import { Calendar } from "./ui/calendar";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { FormSelect } from "./form-select";

type Props = Pick<React.ComponentProps<"input">, "id" | "name" | "required" | "disabled" | "aria-label" | "aria-labelledby" | "aria-describedby" | "aria-invalid"> & {
  value: string; onValueChange: (value: string) => void; min?: string; max?: string;
};
function dateFrom(value?: string) {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}
function dateValue(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Fieldnotes Calendar + Popover, using local civil dates without UTC conversion. */
export function DatePicker({ value, onValueChange, min, max, ...props }: Props) {
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const selected = dateFrom(value);
  const end = dateFrom(max) ?? new Date();
  const start = dateFrom(min) ?? new Date(end.getFullYear() - 120, 0, 1);
  if (!mounted) return <Input {...props} type="date" value={value} min={min} max={max} onChange={event => onValueChange(event.target.value)} />;
  return <Popover open={open} onOpenChange={setOpen}>
    <Input type="date" name={props.name} value={value} min={min} max={max} required={props.required} disabled={props.disabled}
      onChange={event => onValueChange(event.target.value)} className="sr-only" tabIndex={-1} aria-hidden="true"
      onInvalid={event => { event.preventDefault(); setOpen(true); }} />
    <PopoverTrigger asChild>
      <Button {...props} name={undefined} type="button" variant="outline" aria-required={props.required || undefined} className="w-full justify-between font-normal">
        <span>{selected ? selected.toLocaleDateString("en-PH", { dateStyle: "medium" }) : "Choose a date"}</span>
        <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-auto p-0">
      <Calendar mode="single" selected={selected} defaultMonth={selected ?? end} autoFocus captionLayout="dropdown"
        startMonth={start} endMonth={end} disabled={[{ before: start }, { after: end }]}
        components={{ Dropdown: ({ options, value, onChange, "aria-label": label, disabled }) => <FormSelect size="sm" aria-label={label} value={value} disabled={disabled} onChange={onChange}>
          {options?.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
        </FormSelect> }}
        onSelect={date => { if (date) { onValueChange(dateValue(date)); setOpen(false); } }} />
    </PopoverContent>
  </Popover>;
}
