"use client";
import { useId, useState } from "react";
import { Check, X } from "lucide-react";
import { formatPeso } from "@race-pace/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { applyDiscount, restartDiscountCheckout } from "@/lib/discounts";
export type DiscountCodeFieldProps = {
  registrationId: string;
  code?: string | null;
  savings?: number;
  absorbed?: boolean;
  disabled?: boolean;
  restartable?: boolean;
  onApplied: () => Promise<unknown> | void;
  onBusy?: (busy: boolean) => void;
};
export function DiscountCodeField({
  registrationId,
  code,
  savings = 0,
  absorbed = false,
  disabled = false,
  restartable = false,
  onApplied,
  onBusy,
}: DiscountCodeFieldProps) {
  const id = useId(),
    [value, setValue] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function apply(next: string) {
    setBusy(true);
    onBusy?.(true);
    setError(null);
    try {
      await applyDiscount(registrationId, next);
      await onApplied();
      setValue("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not apply this code. Try again.",
      );
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }
  return (
    <div className="mt-5 border-t border-border pt-5">
      {code ? (
        <p className="text-sm font-medium">Discount code</p>
      ) : (
        <Label htmlFor={id} className="text-sm font-medium">
          Discount code
        </Label>
      )}
      {code ? (
        <div className="mt-2 flex items-start justify-between gap-3 rounded-lg bg-accent/60 px-3 py-2.5">
          <div className="min-w-0 text-sm">
            <span className="flex items-center gap-2 font-medium">
              <Check
                className="size-4 shrink-0 text-primary"
                aria-hidden="true"
              />
              <span className="break-all font-mono">{code}</span>
            </span>
            <span className="mt-1 block text-muted-foreground">
              You save {formatPeso(savings)}
              {absorbed ? ". Organizer covers all fees." : "."}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="min-h-11 min-w-11 shrink-0"
            disabled={busy || disabled}
            aria-label="Remove discount code"
            onClick={() => apply("")}
          >
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex gap-2">
          <Input
            id={id}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (value.trim() && !busy && !disabled) void apply(value);
              }
            }}
            placeholder="Enter your code"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={40}
            disabled={busy || disabled}
            aria-invalid={!!error}
            aria-describedby={`${id}-feedback`}
            className="h-11 min-w-0 font-mono uppercase"
          />
          <Button
            type="button"
            variant="outline"
            className="h-11"
            disabled={busy || disabled || !value.trim()}
            onClick={() => apply(value)}
          >
            {busy ? "Applying…" : "Apply"}
          </Button>
        </div>
      )}
      <div id={`${id}-feedback`} className="mt-2 text-sm" aria-live="polite">
        {error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : disabled ? (
          <p className="text-muted-foreground">
            Code changes are locked while payment is in progress.
          </p>
        ) : code ? (
          <span className="sr-only">
            Discount applied. You save {formatPeso(savings)}.
          </span>
        ) : (
          <p className="text-xs text-muted-foreground">
            One code per Passport. Savings appear before you pay.
          </p>
        )}
      </div>
      {disabled && restartable && (
        <Button
          type="button"
          variant="link"
          className="mt-1 h-auto min-h-11 px-0"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            onBusy?.(true);
            setError(null);
            try {
              await restartDiscountCheckout(registrationId);
              await onApplied();
            } catch (cause) {
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Could not close payment.",
              );
            } finally {
              setBusy(false);
              onBusy?.(false);
            }
          }}
        >
          {busy ? "Closing payment…" : "Close unpaid checkout to change code"}
        </Button>
      )}
    </div>
  );
}
