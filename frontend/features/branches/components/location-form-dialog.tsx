"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { SelectField, TextField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { errorMessage } from "@/lib/api/errors";
import { applyServerErrors } from "@/lib/forms";

import { useCreateLocation } from "../api";

export const LOCATION_TYPES = [
  { value: "STORE", label: "Store floor" },
  { value: "BACKROOM", label: "Backroom" },
  { value: "WAREHOUSE", label: "Warehouse" },
];

const schema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9][A-Z0-9_-]{1,15}$/, "2–16 uppercase letters, digits, - or _"),
  name: z.string().trim().min(2, "At least 2 characters").max(200),
  location_type: z.enum(["STORE", "BACKROOM", "WAREHOUSE"]),
  is_default: z.boolean(),
});

type LocationValues = z.infer<typeof schema>;
const DEFAULTS: LocationValues = { code: "", name: "", location_type: "WAREHOUSE", is_default: false };

export function LocationFormDialog({
  branchId,
  open,
  onOpenChange,
}: {
  branchId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateLocation(branchId);
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<LocationValues>({ resolver: zodResolver(schema), defaultValues: DEFAULTS });

  useEffect(() => {
    if (open) reset(DEFAULTS);
  }, [open, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await create.mutateAsync(values);
      toast.success(`Location ${values.code} added`);
      onOpenChange(false);
    } catch (error) {
      if (!applyServerErrors(error, setError, ["code", "name"])) toast.error(errorMessage(error));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New stock location</DialogTitle>
        </DialogHeader>
        <form id="location-form" onSubmit={onSubmit} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
            <TextField
              label="Code"
              className="uppercase"
              error={errors.code?.message}
              {...register("code", { setValueAs: (v: string) => v.toUpperCase() })}
            />
            <TextField label="Name" error={errors.name?.message} {...register("name")} />
          </div>
          <Controller
            control={control}
            name="location_type"
            render={({ field }) => (
              <SelectField label="Type" value={field.value} onChange={field.onChange} options={LOCATION_TYPES} />
            )}
          />
          <Controller
            control={control}
            name="is_default"
            render={({ field }) => (
              <Field orientation="horizontal">
                <Checkbox id="is-default" checked={field.value} onCheckedChange={field.onChange} />
                <FieldLabel htmlFor="is-default">Make this the branch&apos;s default selling location</FieldLabel>
              </Field>
            )}
          />
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="location-form" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Add location"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
