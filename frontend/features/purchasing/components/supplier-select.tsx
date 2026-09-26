"use client";

import { SimpleSelect } from "@/components/shared/form-fields";

import { useSuppliers } from "../api";

export function SupplierSelect({ value, onChange, allowAll }: { value: string; onChange: (id: string) => void; allowAll?: boolean }) {
  const { data } = useSuppliers({ limit: 200, offset: 0 });
  const options = [
    ...(allowAll ? [{ value: "__all__", label: "All suppliers" }] : []),
    ...(data?.items ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.code})` })),
  ];
  return (
    <SimpleSelect
      aria-label="Supplier"
      placeholder="Select supplier"
      value={allowAll && value === "" ? "__all__" : value}
      onChange={(v) => onChange(v === "__all__" ? "" : v)}
      options={options}
    />
  );
}
