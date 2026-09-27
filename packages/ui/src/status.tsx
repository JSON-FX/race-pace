import * as React from "react";
import { Badge } from "./ui/badge";

export type StatusProps = React.HTMLAttributes<HTMLSpanElement> & {
  dot?: boolean;
  tone?: "success" | "warning" | "danger" | "info" | "neutral";
};

export function Status({
  tone = "neutral",
  dot = true,
  className,
  children,
  ...props
}: StatusProps) {
  return (
    <Badge
      variant="outline"
      className={["rp-fn-status", className].filter(Boolean).join(" ")}
      data-tone={tone}
      {...props}
    >
      {dot ? <span className="rp-fn-status-dot" aria-hidden="true" /> : null}
      {children}
    </Badge>
  );
}
