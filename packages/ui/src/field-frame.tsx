"use client";

import * as React from "react";
import { Field, FieldLabel, FieldDescription, FieldError } from "./ui/field";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/native-select";
import { FormSelect } from "./form-select";
import { DatePicker } from "./date-picker";
import { Checkbox } from "./ui/checkbox";
import { SelectTrigger } from "./ui/select";
import { InputGroupInput } from "./ui/input-group";

type ControlProps = React.HTMLAttributes<HTMLElement> & { children?: React.ReactNode; type?: string; required?: boolean };
const controls: unknown[] = [Input, Textarea, NativeSelect, FormSelect, DatePicker, Checkbox, SelectTrigger, InputGroupInput];
function isControl(child: React.ReactElement<ControlProps>) {
  return controls.includes(child.type) || (typeof child.type === "string" && ["input", "select", "textarea"].includes(child.type) && child.props.type !== "hidden");
}

/** Keeps existing controlled form fields while associating labels and feedback. */
export function FieldFrame({ label, htmlFor, required, hint, error, children, className }: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const generated = React.useId();
  let firstId: string | undefined;
  function findControl(nodes: React.ReactNode) {
    React.Children.forEach(nodes, (child) => {
      if (!React.isValidElement<ControlProps>(child)) return;
      if (isControl(child)) firstId ??= child.props.id ?? htmlFor ?? generated;
      else findControl(child.props.children);
    });
  }
  findControl(children);
  const id = firstId ?? htmlFor ?? generated;
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  let assignedFirst = false;
  function associate(nodes: React.ReactNode): React.ReactNode {
    return React.Children.map(nodes, (child) => {
      if (!React.isValidElement<ControlProps>(child)) return child;
      if (isControl(child)) {
        const controlId = child.props.id ?? (!assignedFirst ? id : undefined);
        assignedFirst = true;
        return React.cloneElement(child, {
          id: controlId,
          ...(required && child.type !== SelectTrigger ? { required: child.props.required ?? true } : {}),
          "aria-required": required ? true : child.props["aria-required"],
          "aria-invalid": error ? true : child.props["aria-invalid"],
          "aria-describedby": [child.props["aria-describedby"], describedBy].filter(Boolean).join(" ") || undefined,
        });
      }
      return child.props.children ? React.cloneElement(child, { children: associate(child.props.children) }) : child;
    });
  }
  return (
    <Field className={className} data-invalid={!!error} role={firstId ? undefined : "group"} aria-labelledby={firstId ? undefined : `${id}-label`} aria-describedby={firstId ? undefined : describedBy}>
      <FieldLabel id={`${id}-label`} htmlFor={firstId ?? htmlFor}>
        {label}{required ? <> <span aria-hidden="true">*</span></> : null}
      </FieldLabel>
      {associate(children)}
      {hint ? <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription> : null}
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </Field>
  );
}
