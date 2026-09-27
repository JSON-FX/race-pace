"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type FieldProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "size"
> & {
  label: string;
  hint?: string;
  error?: string;
};

export const Field = React.forwardRef<HTMLInputElement, FieldProps>(
  function Field(
    { id, label, hint, error, required, className, ...props },
    ref,
  ) {
    const generatedId = React.useId();
    const fieldId = id ?? generatedId;
    const hintId = hint ? `${fieldId}-hint` : undefined;
    const errorId = error ? `${fieldId}-error` : undefined;
    const describedBy =
      [props["aria-describedby"], hintId, errorId].filter(Boolean).join(" ") ||
      undefined;

    return (
      <div className={["rp-fn-field", className].filter(Boolean).join(" ")}>
        <Label htmlFor={fieldId}>
          {label}
          {required ? <span aria-hidden="true"> *</span> : null}
        </Label>
        <Input
          {...props}
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={error ? true : props["aria-invalid"]}
          aria-describedby={describedBy}
          className="rp-fn-input"
        />
        {hint ? (
          <p id={hintId} className="rp-fn-hint">
            {hint}
          </p>
        ) : null}
        {error ? (
          <p id={errorId} className="rp-fn-error">
            {error}
          </p>
        ) : null}
      </div>
    );
  },
);
