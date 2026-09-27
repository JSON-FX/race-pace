"use client";

import { ChoiceGroup } from "@race-pace/ui";

export function PillSelect({ label, value, options, onChange, error, required }: {
  label: string; value: string; options: readonly string[]; onChange: (value: string) => void; error?: string; required?: boolean;
}) {
  return <div className="mt-6"><ChoiceGroup required={required} label={label} value={value} options={options.map((option) => ({ value: option, label: option }))} onValueChange={onChange} error={error} /></div>;
}
