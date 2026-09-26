"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { TextAreaField, TextField } from "@/components/shared/form-fields";
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
import { applyServerErrors, emptyToNull } from "@/lib/forms";
import type { Branch } from "@/types/api";

import { useCreateBranch, useUpdateBranch } from "../api";

const schema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9][A-Z0-9_-]{1,15}$/, "2–16 uppercase letters, digits, - or _"),
  name: z.string().trim().min(2, "At least 2 characters").max(200),
  address: z.string().max(500),
  phone: z.string().max(50),
  tin: z.string().max(32),
  receipt_header: z.string().max(1000),
  receipt_footer: z.string().max(1000),
});

type BranchValues = z.infer<typeof schema>;
const FIELDS = ["code", "name", "address", "phone", "tin", "receipt_header", "receipt_footer"] as const;

function toValues(branch?: Branch): BranchValues {
  return {
    code: branch?.code ?? "",
    name: branch?.name ?? "",
    address: branch?.address ?? "",
    phone: branch?.phone ?? "",
    tin: branch?.tin ?? "",
    receipt_header: branch?.receipt_header ?? "",
    receipt_footer: branch?.receipt_footer ?? "",
  };
}

interface BranchFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this branch; omit to create a new one. */
  branch?: Branch;
  onSaved?: (branch: Branch) => void;
}

export function BranchFormDialog({ open, onOpenChange, branch, onSaved }: BranchFormDialogProps) {
  const create = useCreateBranch();
  const update = useUpdateBranch(branch?.id ?? "");
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<BranchValues>({ resolver: zodResolver(schema), defaultValues: toValues(branch) });

  useEffect(() => {
    if (open) reset(toValues(branch));
  }, [open, branch, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const optional = {
      address: emptyToNull(values.address),
      phone: emptyToNull(values.phone),
      tin: emptyToNull(values.tin),
      receipt_header: emptyToNull(values.receipt_header),
      receipt_footer: emptyToNull(values.receipt_footer),
    };
    try {
      const saved = branch
        ? await update.mutateAsync({ name: values.name, ...optional })
        : await create.mutateAsync({ code: values.code, name: values.name, ...optional });
      toast.success(branch ? "Branch updated" : `Branch ${saved.code} created`);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (error) {
      if (!applyServerErrors(error, setError, FIELDS)) toast.error(errorMessage(error));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{branch ? `Edit ${branch.code}` : "New branch"}</DialogTitle>
          <DialogDescription>
            {branch ? "Update store details and receipt text." : "A default STORE location is created automatically."}
          </DialogDescription>
        </DialogHeader>
        <form id="branch-form" onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <TextField
              label="Code"
              disabled={Boolean(branch)}
              className="uppercase"
              error={errors.code?.message}
              {...register("code", { setValueAs: (v: string) => v.toUpperCase() })}
            />
            <TextField label="Name" error={errors.name?.message} {...register("name")} />
          </div>
          <TextField label="Address" error={errors.address?.message} {...register("address")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Phone" type="tel" error={errors.phone?.message} {...register("phone")} />
            <TextField label="TIN" error={errors.tin?.message} {...register("tin")} />
          </div>
          <TextAreaField label="Receipt header" rows={2} error={errors.receipt_header?.message} {...register("receipt_header")} />
          <TextAreaField label="Receipt footer" rows={2} error={errors.receipt_footer?.message} {...register("receipt_footer")} />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="branch-form" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
