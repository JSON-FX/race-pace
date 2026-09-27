"use client";

import * as React from "react";
import { NativeSelect } from "./ui/native-select";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "./ui/select";
import { cn } from "./lib/utils";

type Props = Omit<React.ComponentProps<typeof NativeSelect>, "multiple">;
type Option = { value: string; label: React.ReactNode; disabled?: boolean; group?: string };
const EMPTY = "__race_pace_empty_choice__";

function optionsFrom(children: React.ReactNode, group?: string, disabled?: boolean): Option[] {
  return React.Children.toArray(children).flatMap(child => {
    if (!React.isValidElement<{ value?: string | number; children?: React.ReactNode; label?: string; disabled?: boolean }>(child)) return [];
    if (child.type === React.Fragment) return optionsFrom(child.props.children, group, disabled);
    if (child.type === "optgroup") return optionsFrom(child.props.children, child.props.label, child.props.disabled);
    return [{ value: String(child.props.value ?? child.props.children ?? ""), label: child.props.children, disabled: disabled || child.props.disabled, group }];
  });
}

/** Native select before hydration and for FormData/validation; Radix owns the visible menu. */
export function FormSelect({ children, className, wrapperClassName, size, ref, ...props }: Props) {
  const generated = React.useId();
  const id = props.id ?? generated;
  const native = React.useRef<HTMLSelectElement>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const options = optionsFrom(children);
  const [mounted, setMounted] = React.useState(false);
  const [uncontrolled, setUncontrolled] = React.useState(String(props.defaultValue ?? options[0]?.value ?? ""));
  const value = props.value === undefined ? uncontrolled : String(props.value);
  React.useEffect(() => {
    setMounted(true);
    const form = native.current?.form;
    const reset = () => setUncontrolled(String(props.defaultValue ?? options[0]?.value ?? ""));
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [props.defaultValue, options[0]?.value]);
  const empty = options.find(option => !option.value);
  const items = (rows: Option[]) => rows.map(option => <SelectItem key={option.value} value={option.value || EMPTY} disabled={option.disabled}>{option.label}</SelectItem>);
  const groups = [...new Set(options.map(option => option.group))];
  const nativeControl = (<NativeSelect {...props} id={mounted ? `${id}-native` : id} ref={node => {
      native.current = node;
      if (typeof ref === "function") ref(node); else if (ref) ref.current = node;
    }} value={value} defaultValue={undefined} size={size} className={mounted ? "sr-only" : className}
      wrapperClassName={mounted ? "sr-only" : undefined} tabIndex={mounted ? -1 : props.tabIndex} aria-hidden={mounted || undefined}
      aria-label={mounted ? undefined : props["aria-label"]} aria-labelledby={mounted ? undefined : props["aria-labelledby"]}
      onChange={event => { setUncontrolled(event.target.value); props.onChange?.(event); }}
      onInvalid={event => { props.onInvalid?.(event); if (mounted) { event.preventDefault(); trigger.current?.focus(); } }}>
      {children}
    </NativeSelect>);
  return <div className={cn("relative w-full min-w-0", wrapperClassName)}>
    {mounted ? <Select value={value || EMPTY} disabled={props.disabled} onValueChange={next => {
      const element = native.current;
      if (!element) return;
      // Use the platform setter so React observes the real native change event.
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(element, next === EMPTY ? "" : next);
      element.dispatchEvent(new Event("change", { bubbles: true }));
    }}>
      <SelectTrigger ref={trigger} id={id} size={size} className={cn("w-full min-w-0", className)}
        aria-label={props["aria-label"]} aria-labelledby={props["aria-labelledby"]} aria-describedby={props["aria-describedby"]}
        aria-invalid={props["aria-invalid"]} aria-required={props.required || props["aria-required"]} tabIndex={props.tabIndex}>
        <SelectValue>{options.find(option => option.value === value)?.label ?? empty?.label ?? "Choose an option"}</SelectValue>
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        {groups.map((group, index) => group ? <SelectGroup key={group}><SelectLabel>{group}</SelectLabel>{items(options.filter(option => option.group === group))}</SelectGroup> : <React.Fragment key={index}>{items(options.filter(option => !option.group))}</React.Fragment>)}
      </SelectContent>
    </Select> : null}
    {nativeControl}
  </div>;
}
