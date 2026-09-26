"use client";

import { SimpleSelect } from "@/components/shared/form-fields";

import { useStockLocations } from "../api";

const DEFAULT = "__default__";

interface Props {
  value: string;
  onChange: (id: string) => void;
  /** Adds a "Branch default" choice that maps to "". */
  allowDefault?: boolean;
  /** Adds an "All locations" choice that maps to "". */
  allowAll?: boolean;
  exclude?: string;
  className?: string;
  "aria-label"?: string;
}

export function StockLocationSelect({ value, onChange, allowDefault, allowAll, exclude, className, "aria-label": ariaLabel }: Props) {
  const { data } = useStockLocations();
  const blank = allowAll ? "All locations" : allowDefault ? "Default location" : null;
  const options = [
    ...(blank ? [{ value: DEFAULT, label: blank }] : []),
    ...data
      .filter((l) => l.is_active && l.id !== exclude)
      .map((l) => ({ value: l.id, label: `${l.branchCode} · ${l.name}${l.is_default ? " (default)" : ""}` })),
  ];
  return (
    <SimpleSelect
      aria-label={ariaLabel ?? "Stock location"}
      className={className}
      placeholder="Select location"
      value={blank && value === "" ? DEFAULT : value}
      onChange={(v) => onChange(v === DEFAULT ? "" : v)}
      options={options}
    />
  );
}
