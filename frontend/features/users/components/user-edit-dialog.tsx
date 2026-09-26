"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { TextField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { errorMessage } from "@/lib/api/errors";
import { applyServerErrors } from "@/lib/forms";
import type { User } from "@/types/api";

import { useSetUserRoles, useUpdateUser } from "../api";
import { roleAssignmentsSchema } from "../schemas";
import { RoleAssignmentsField } from "./role-assignments-field";

const schema = z.object({
  full_name: z.string().trim().min(2, "At least 2 characters").max(200),
  email: z.email("Enter a valid email"),
  roles: roleAssignmentsSchema,
});

type EditUserValues = z.infer<typeof schema>;

function toValues(user: User): EditUserValues {
  return {
    full_name: user.full_name,
    email: user.email,
    roles: user.roles.map((r) => ({ role_id: r.role_id, branch_id: r.branch_id })),
  };
}

function sameRoles(a: EditUserValues["roles"], b: EditUserValues["roles"]): boolean {
  const key = (rows: EditUserValues["roles"]) => rows.map((r) => `${r.role_id}:${r.branch_id}`).sort().join("|");
  return key(a) === key(b);
}

interface UserEditDialogProps {
  user: User | null;
  /** Editing your own roles is refused by the server; hide the control. */
  isSelf: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UserEditDialog({ user, isSelf, onOpenChange }: UserEditDialogProps) {
  const updateUser = useUpdateUser();
  const setRoles = useSetUserRoles();
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<EditUserValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (user) reset(toValues(user));
  }, [user, reset]);

  if (!user) return null;
  const initial = toValues(user);

  const onSubmit = handleSubmit(async (values) => {
    try {
      if (values.full_name !== initial.full_name || values.email !== initial.email) {
        await updateUser.mutateAsync({ id: user.id, data: { full_name: values.full_name, email: values.email } });
      }
      if (!isSelf && !sameRoles(values.roles, initial.roles)) {
        await setRoles.mutateAsync({ id: user.id, roles: values.roles });
      }
      toast.success("User updated");
      onOpenChange(false);
    } catch (error) {
      if (!applyServerErrors(error, setError, ["full_name", "email"])) toast.error(errorMessage(error));
    }
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Edit {user.full_name}</DialogTitle>
        </DialogHeader>
        <form id="user-edit-form" onSubmit={onSubmit} className="grid gap-4" noValidate>
          <TextField label="Full name" error={errors.full_name?.message} {...register("full_name")} />
          <TextField label="Email" type="email" error={errors.email?.message} {...register("email")} />
          {isSelf ? (
            <p className="text-sm text-muted-foreground">You can&apos;t change your own roles.</p>
          ) : (
            <Controller
              control={control}
              name="roles"
              render={({ field, fieldState }) => (
                <RoleAssignmentsField value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
              )}
            />
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="user-edit-form" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
