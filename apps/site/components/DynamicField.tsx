"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { PillSelect } from "@/components/PillSelect";
import type { FormFieldRow } from "@/lib/events";

/** Renders one organizer-configured `form_fields` row. Mirrors
 *  apps/mobile/components/DynamicField.tsx so the same event's questions
 *  look and behave the same on both surfaces. */
export function DynamicField({ field, value, onChange, error }: {
  field: FormFieldRow;
  value: unknown;
  onChange: (v: unknown) => void;
  error?: string;
}) {
  const label = `${field.label}${field.required ? " *" : ""}`;

  if (field.type === "select") {
    return (
      <PillSelect
        label={label}
        value={(value as string) ?? ""}
        options={field.options ?? []}
        onChange={onChange}
        error={error}
      />
    );
  }

  if (field.type === "checkbox") {
    return (
      <div className="mt-6 flex items-center gap-3 rounded-lg border border-border p-4">
        <Checkbox id={field.key} checked={!!value} onCheckedChange={(c) => onChange(c === true)} />
        <Label htmlFor={field.key} className="text-[14px]">{label}</Label>
      </div>
    );
  }

  if (field.type === "file") {
    return (
      <p className="mt-6 text-[14px] italic text-muted-foreground">
        {field.label}: file uploads aren&apos;t supported on the web yet.
      </p>
    );
  }

  const inputType = field.type === "number" ? "number" : field.type === "date" ? "date" : "text";

  return (
    <div className="mt-6 flex flex-col gap-2">
      <Label htmlFor={field.key}>{label}</Label>
      <Input
        id={field.key}
        type={inputType}
        value={value != null ? String(value) : ""}
        onChange={(e) => {
          const raw = e.target.value;
          // A number field must yield a number (or undefined), never a string —
          // customDataSchema types it as z.number().
          onChange(field.type === "number" ? (raw === "" ? undefined : Number(raw)) : raw);
        }}
        aria-invalid={!!error}
      />
      {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
    </div>
  );
}
