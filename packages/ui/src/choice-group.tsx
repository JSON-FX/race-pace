"use client";

import { useId, type ReactNode } from "react";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { FieldError, FieldLegend, FieldSet } from "./ui/field";
import { Label } from "./ui/label";
import { cn } from "./lib/utils";

/** A shared single-choice composition for sizes, methods and segmented terms. */
export function ChoiceGroup<T extends string>({ label, value, options, onValueChange, error, disabled, className, name, required, variant = "cards", hideLabel = false }: {
  label: string;
  value: T;
  options: readonly { value: T; label: ReactNode; disabled?: boolean }[];
  onValueChange: (value: T) => void;
  error?: string;
  disabled?: boolean;
  className?: string;
  name?: string;
  required?: boolean;
  variant?: "cards" | "plain";
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <FieldSet className="gap-2">
      <FieldLegend id={`${id}-label`} className={hideLabel ? "sr-only" : "mb-0 text-sm"}>{label}</FieldLegend>
      <RadioGroup value={value} name={name} required={required} aria-required={required || undefined} onValueChange={next => { if (options.some(option => option.value === next)) onValueChange(next as T); }} disabled={disabled}
        aria-labelledby={`${id}-label`} aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={!!error} className={cn("flex flex-wrap gap-2", className)}>
        {options.map((option, index) => (
          <Label key={option.value} htmlFor={`${id}-${index}`}
            className={cn("flex min-h-11 cursor-pointer items-center gap-3", variant === "cards" ? "rounded-[14px] border border-input px-3 py-2 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent has-[[data-state=checked]]:text-accent-foreground" : "pr-4") }>
            <RadioGroupItem id={`${id}-${index}`} value={option.value} disabled={option.disabled} />
            {option.label}
          </Label>
        ))}
      </RadioGroup>
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </FieldSet>
  );
}
