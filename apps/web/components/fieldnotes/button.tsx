"use client";

import * as React from "react";
import { Button as Primitive } from "@/components/ui/button";
import { Spinner } from "./spinner";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "compact" | "default" | "prominent";
  loading?: boolean;
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "default",
      loading = false,
      disabled,
      className,
      children,
      ...props
    },
    ref,
  ) {
    return (
      <Primitive
        ref={ref}
        variant={
          variant === "primary"
            ? "default"
            : variant === "danger"
              ? "destructive"
              : variant
        }
        size={
          size === "compact" ? "sm" : size === "prominent" ? "lg" : "default"
        }
        className={["rp-fn-button", className].filter(Boolean).join(" ")}
        data-variant={variant}
        data-size={size}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Spinner aria-hidden="true" /> : null}
        {children}
      </Primitive>
    );
  },
);
