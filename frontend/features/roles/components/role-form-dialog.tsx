"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { TextField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldError, FieldLabel } from "@/components/ui/field";
import { errorMessage } from "@/lib/api/errors";
import { applyServerErrors, emptyToNull } from "@/lib/forms";
import type { Role } from "@/types/api";

import { useCreateRole, usePermissionCatalog, useUpdateRole } from "../api";
import { PermissionPicker } from "./permission-picker";

const schema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]{1,31}$/, "2–32 uppercase letters, digits or _ (starting with a letter)"),
  name: z.string().trim().min(2, "At least 2 characters").max(100),
  description: z.string().max(500),
  permissions: z.array(z.string()),
});

type RoleValues = z.infer<typeof schema>;

function toValues(role: Role | null): RoleValues {
  return {
    code: role?.code ?? "",
    name: role?.name ?? "",
    description: role?.description ?? "",
    permissions: role?.permissions ?? [],
  };
}

interface RoleFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this role; null creates a new one. */
  role: Role | null;
}

export function RoleFormDialog({ open, onOpenChange, role }: RoleFormDialogProps) {
  const { data: catalog } = usePermissionCatalog();
  const create = useCreateRole();
  const update = useUpdateRole();
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<RoleValues>({ resolver: zodResolver(schema), defaultValues: toValues(role) });

  useEffect(() => {
    if (open) reset(toValues(role));
  }, [open, role, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (role) {
        await update.mutateAsync({
          id: role.id,
          data: { name: values.name, description: emptyToNull(values.description), permissions: values.permissions },
        });
      } else {
        await create.mutateAsync({ ...values, description: emptyToNull(values.description) });
      }
      toast.success(role ? "Role updated" : `Role ${values.code} created`);
      onOpenChange(false);
    } catch (error) {
      if (!applyServerErrors(error, setError, ["code", "name", "description"])) toast.error(errorMessage(error));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{role ? `Edit ${role.name}` : "New role"}</DialogTitle>
          <DialogDescription>
            You can only grant permissions you hold yourself. Changes apply to users within seconds.
          </DialogDescription>
        </DialogHeader>
        <form id="role-form" onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
            <TextField
              label="Code"
              disabled={Boolean(role)}
              className="uppercase"
              error={errors.code?.message}
              {...register("code", { setValueAs: (v: string) => v.toUpperCase() })}
            />
            <TextField label="Name" error={errors.name?.message} {...register("name")} />
          </div>
          <TextField label="Description" error={errors.description?.message} {...register("description")} />
          <div className="space-y-2">
            <FieldLabel>Permissions</FieldLabel>
            <Controller
              control={control}
              name="permissions"
              render={({ field }) => <PermissionPicker catalog={catalog} value={field.value} onChange={field.onChange} />}
            />
            <FieldError>{errors.permissions?.message}</FieldError>
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="role-form" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
