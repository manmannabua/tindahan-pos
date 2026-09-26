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
import { errorMessage } from "@/lib/api/errors";
import { applyServerErrors } from "@/lib/forms";

import { useCreateUser } from "../api";
import { passwordSchema, pinSchema, roleAssignmentsSchema, usernameSchema } from "../schemas";
import { RoleAssignmentsField } from "./role-assignments-field";

const schema = z.object({
  full_name: z.string().trim().min(2, "At least 2 characters").max(200),
  email: z.email("Enter a valid email"),
  username: usernameSchema,
  password: passwordSchema,
  pin: z.union([z.literal(""), pinSchema]),
  roles: roleAssignmentsSchema,
});

type CreateUserValues = z.infer<typeof schema>;
const DEFAULTS: CreateUserValues = {
  full_name: "",
  email: "",
  username: "",
  password: "",
  pin: "",
  roles: [{ role_id: "", branch_id: null }],
};

export function UserCreateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useCreateUser();
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateUserValues>({ resolver: zodResolver(schema), defaultValues: DEFAULTS });

  useEffect(() => {
    if (open) reset(DEFAULTS);
  }, [open, reset]);

  const onSubmit = handleSubmit(async ({ pin, ...values }) => {
    try {
      const user = await create.mutateAsync({ ...values, ...(pin ? { pin } : {}) });
      toast.success(`${user.full_name} added`);
      onOpenChange(false);
    } catch (error) {
      if (!applyServerErrors(error, setError, ["full_name", "email", "username", "password", "pin"])) {
        toast.error(errorMessage(error));
      }
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New user</DialogTitle>
          <DialogDescription>
            Cashiers sign in to terminals with their username and PIN; the password is for the admin portal.
          </DialogDescription>
        </DialogHeader>
        <form id="user-create-form" onSubmit={onSubmit} className="grid gap-4" noValidate>
          <TextField label="Full name" error={errors.full_name?.message} {...register("full_name")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Email" type="email" error={errors.email?.message} {...register("email")} />
            <TextField
              label="Username"
              error={errors.username?.message}
              {...register("username", { setValueAs: (v: string) => v.toLowerCase() })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Password"
              type="password"
              autoComplete="new-password"
              error={errors.password?.message}
              {...register("password")}
            />
            <TextField
              label="POS PIN (optional)"
              inputMode="numeric"
              autoComplete="off"
              error={errors.pin?.message}
              {...register("pin")}
            />
          </div>
          <Controller
            control={control}
            name="roles"
            render={({ field, fieldState }) => (
              <RoleAssignmentsField value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
            )}
          />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="user-create-form" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create user"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
