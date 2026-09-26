"use client";

import { PlusIcon, XIcon } from "lucide-react";

import { SimpleSelect } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { FieldError, FieldLabel } from "@/components/ui/field";
import { useBranches } from "@/features/branches/api";
import { useRoles } from "@/features/roles/api";
import type { RoleAssignment } from "@/types/api";

const ALL_BRANCHES = "__all__";

interface RoleAssignmentsFieldProps {
  value: RoleAssignment[];
  onChange: (value: RoleAssignment[]) => void;
  error?: string;
}

/**
 * Role assignments: each row is a role, either company-wide or limited to one branch.
 * The server refuses assignments granting permissions the editor doesn't hold (role.escalation).
 */
export function RoleAssignmentsField({ value, onChange, error }: RoleAssignmentsFieldProps) {
  const { data: roles = [] } = useRoles();
  const { data: branches = [] } = useBranches();

  const roleOptions = roles.map((r) => ({ value: r.id, label: r.name }));
  const branchOptions = [
    { value: ALL_BRANCHES, label: "All branches" },
    ...branches.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` })),
  ];

  const updateRow = (index: number, patch: Partial<RoleAssignment>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <div className="space-y-2">
      <FieldLabel>Roles</FieldLabel>
      {value.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <SimpleSelect
            aria-label="Role"
            className="w-full flex-1"
            placeholder="Choose a role"
            value={row.role_id}
            onChange={(roleId) => updateRow(index, { role_id: roleId })}
            options={roleOptions}
          />
          <SimpleSelect
            aria-label="Branch scope"
            className="w-full flex-1"
            value={row.branch_id ?? ALL_BRANCHES}
            onChange={(branchId) => updateRow(index, { branch_id: branchId === ALL_BRANCHES ? null : branchId })}
            options={branchOptions}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Remove role"
            disabled={value.length === 1}
            onClick={() => onChange(value.filter((_, i) => i !== index))}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { role_id: "", branch_id: null }])}>
        <PlusIcon /> Add role
      </Button>
      <FieldError>{error}</FieldError>
    </div>
  );
}
