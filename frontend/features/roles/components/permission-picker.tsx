"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import type { Permission } from "@/types/api";

import { groupPermissions } from "../api";

interface PermissionPickerProps {
  catalog: Permission[] | undefined;
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}

/** Permission checkboxes grouped by domain prefix, with a per-group "all" toggle. */
export function PermissionPicker({ catalog, value, onChange, disabled }: PermissionPickerProps) {
  if (!catalog) return <Skeleton className="h-48 w-full" />;
  const selected = new Set(value);

  const toggle = (codes: string[], on: boolean) => {
    const next = new Set(selected);
    for (const code of codes) {
      if (on) next.add(code);
      else next.delete(code);
    }
    onChange([...next].sort());
  };

  return (
    <div className="grid max-h-[50vh] gap-4 overflow-y-auto pr-1 sm:grid-cols-2">
      {groupPermissions(catalog).map(([group, permissions]) => {
        const codes = permissions.map((p) => p.code);
        const all = codes.every((c) => selected.has(c));
        const some = !all && codes.some((c) => selected.has(c));
        return (
          <fieldset key={group} className="space-y-2 rounded-lg border p-3">
            <legend className="px-1">
              <label className="flex items-center gap-2 text-sm font-semibold capitalize">
                <Checkbox
                  checked={all}
                  indeterminate={some}
                  disabled={disabled}
                  onCheckedChange={(on) => toggle(codes, on)}
                  aria-label={`All ${group} permissions`}
                />
                {group.replace("_", " ")}
              </label>
            </legend>
            {permissions.map((permission) => (
              <label key={permission.code} className="flex items-start gap-2 text-sm">
                <Checkbox
                  className="mt-0.5"
                  checked={selected.has(permission.code)}
                  disabled={disabled}
                  onCheckedChange={(on) => toggle([permission.code], on)}
                />
                <span>
                  {permission.description}
                  <span className="block font-mono text-xs text-muted-foreground">{permission.code}</span>
                </span>
              </label>
            ))}
          </fieldset>
        );
      })}
    </div>
  );
}
