"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
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
import type { User } from "@/types/api";

import { useResetUserPassword, useSetUserPin } from "../api";
import { passwordSchema, pinSchema } from "../schemas";

interface CredentialDialogProps {
  user: User | null;
  onOpenChange: (open: boolean) => void;
}

const pinForm = z
  .object({ pin: pinSchema, confirm: z.string() })
  .refine((v) => v.pin === v.confirm, { path: ["confirm"], message: "PINs don't match" });

export function SetPinDialog({ user, onOpenChange }: CredentialDialogProps) {
  const setPin = useSetUserPin();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof pinForm>>({ resolver: zodResolver(pinForm), defaultValues: { pin: "", confirm: "" } });

  useEffect(() => {
    if (user) reset({ pin: "", confirm: "" });
  }, [user, reset]);
  if (!user) return null;

  const onSubmit = handleSubmit(async ({ pin }) => {
    try {
      await setPin.mutateAsync({ id: user.id, pin });
      toast.success(`PIN set for ${user.full_name}`);
      onOpenChange(false);
    } catch (error) {
      if (!applyServerErrors(error, setError, ["pin"])) {
        setError("pin", { type: "server", message: errorMessage(error) });
      }
    }
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set POS PIN</DialogTitle>
          <DialogDescription>
            {user.full_name} uses this PIN to sign in to terminals, including offline. Terminals pick up the new
            PIN on their next sync.
          </DialogDescription>
        </DialogHeader>
        <form id="pin-form" onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" noValidate>
          <TextField label="New PIN" type="password" inputMode="numeric" autoComplete="off" error={errors.pin?.message} {...register("pin")} />
          <TextField label="Confirm PIN" type="password" inputMode="numeric" autoComplete="off" error={errors.confirm?.message} {...register("confirm")} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="pin-form" disabled={isSubmitting}>
            Set PIN
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const passwordForm = z.object({ password: passwordSchema });

export function ResetPasswordDialog({ user, onOpenChange }: CredentialDialogProps) {
  const resetPassword = useResetUserPassword();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof passwordForm>>({ resolver: zodResolver(passwordForm), defaultValues: { password: "" } });

  useEffect(() => {
    if (user) reset({ password: "" });
  }, [user, reset]);
  if (!user) return null;

  const onSubmit = handleSubmit(async ({ password }) => {
    try {
      await resetPassword.mutateAsync({ id: user.id, password });
      toast.success(`Password reset for ${user.full_name}. Their other sessions were signed out.`);
      onOpenChange(false);
    } catch (error) {
      if (!applyServerErrors(error, setError, ["password"])) toast.error(errorMessage(error));
    }
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>Sets a new admin-portal password for {user.full_name}.</DialogDescription>
        </DialogHeader>
        <form id="password-form" onSubmit={onSubmit} noValidate>
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            error={errors.password?.message}
            {...register("password")}
          />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="password-form" disabled={isSubmitting}>
            Reset password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
