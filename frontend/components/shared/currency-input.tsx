"use client";

import { type ComponentProps, type FocusEvent, type KeyboardEvent, useId, useLayoutEffect, useRef } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  caretAfterFormat,
  formatCurrencyDisplay,
  isAllowedKey,
  padDecimals,
  sanitizeCurrency,
} from "@/lib/money/currency-input";
import { cn } from "@/lib/utils";

type NativeInputProps = Omit<ComponentProps<"input">, "value" | "onChange" | "type" | "inputMode" | "defaultValue">;

export interface CurrencyInputProps extends NativeInputProps {
  /** Plain decimal string without separators, e.g. "1250.50" ("" when empty). */
  value: string;
  onValueChange: (value: string) => void;
  /** Maximum decimals (2 for prices and amounts, 4 for unit costs). */
  decimals?: number;
  /** Currency symbol shown inside the field. */
  symbol?: string;
}

/**
 * Money input: a peso sign inside the field, thousands separators added while typing, letters
 * refused. The value handed to the form never contains commas, so it can go straight to the API
 * and to lib/money.
 */
export function CurrencyInput({
  value,
  onValueChange,
  decimals = 2,
  symbol = "₱",
  className,
  onKeyDown,
  onBlur,
  ...props
}: CurrencyInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const display = formatCurrencyDisplay(value);

  // After a reformat (a comma appeared or disappeared) put the caret back after the same digit.
  useLayoutEffect(() => {
    const input = ref.current;
    if (pendingCaret.current !== null && input && document.activeElement === input) {
      input.setSelectionRange(pendingCaret.current, pendingCaret.current);
    }
    pendingCaret.current = null;
  });

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !isAllowedKey(e.key)) e.preventDefault();
    onKeyDown?.(e);
  };

  const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
    if (value && value !== ".") onValueChange(padDecimals(value, Math.min(2, decimals)));
    onBlur?.(e);
  };

  return (
    <div className="relative">
      <span
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground"
      >
        {symbol}
      </span>
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className={cn("pl-7 text-right tabular-nums", className)}
        value={display}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        onChange={(e) => {
          const raw = e.target.value;
          const next = sanitizeCurrency(raw, { decimals });
          if (next === null) {
            // Refused (e.g. pasted letters): React restores the previous value; keep the caret.
            pendingCaret.current = Math.max(0, (e.target.selectionStart ?? raw.length) - (raw.length - display.length));
            return;
          }
          pendingCaret.current = caretAfterFormat(raw, e.target.selectionStart ?? raw.length, formatCurrencyDisplay(next));
          onValueChange(next);
        }}
      />
    </div>
  );
}

/** Labeled <CurrencyInput> with the same chrome as TextField. */
export function CurrencyField({
  label,
  error,
  description,
  id,
  ...props
}: CurrencyInputProps & { label: string; error?: string; description?: string }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <CurrencyInput id={inputId} aria-invalid={error ? true : undefined} {...props} />
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError>{error}</FieldError>
    </Field>
  );
}
