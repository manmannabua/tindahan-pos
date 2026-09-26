"use client";

import type { ComponentProps } from "react";

import { Input } from "@/components/ui/input";

/** Decimal-string input for money/quantities: never converts through JS numbers. */
export function DecimalInput({
  value,
  onValueChange,
  decimals = 2,
  ...props
}: Omit<ComponentProps<"input">, "value" | "onChange" | "type"> & {
  value: string;
  onValueChange: (value: string) => void;
  decimals?: number;
}) {
  const pattern = new RegExp(`^\\d*(\\.\\d{0,${decimals}})?$`);
  return (
    <Input
      {...props}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={value}
      onChange={(e) => {
        const next = e.target.value.replace(",", ".");
        if (next === "" || pattern.test(next)) onValueChange(next);
      }}
    />
  );
}
