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
import { applyServerErrors, emptyToNull } from "@/lib/forms";
import type { Device } from "@/types/api";

import { useUpdateDevice } from "../api";

const schema = z.object({
  name: z.string().trim().min(1, "Required").max(100),
  bir_min: z.string().trim().max(32),
  bir_serial_number: z.string().trim().max(64),
  bir_ptu_number: z.string().trim().max(64),
  bir_ptu_issued_on: z.string(),
});

type DeviceValues = z.infer<typeof schema>;
const FIELDS = ["name", "bir_min", "bir_serial_number", "bir_ptu_number", "bir_ptu_issued_on"] as const;

function toValues(device: Device | null): DeviceValues {
  return {
    name: device?.name ?? "",
    bir_min: device?.bir_min ?? "",
    bir_serial_number: device?.bir_serial_number ?? "",
    bir_ptu_number: device?.bir_ptu_number ?? "",
    bir_ptu_issued_on: device?.bir_ptu_issued_on ?? "",
  };
}

/**
 * Terminal name and BIR registration (MIN, serial number, PTU). These print on every receipt and
 * reading; the terminal picks up changes on its next sync.
 */
export function DeviceEditDialog({ device, onOpenChange }: { device: Device | null; onOpenChange: (open: boolean) => void }) {
  const update = useUpdateDevice(device?.id ?? "");
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<DeviceValues>({ resolver: zodResolver(schema), defaultValues: toValues(device) });

  useEffect(() => {
    if (device) reset(toValues(device));
  }, [device, reset]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await update.mutateAsync({
        name: values.name,
        bir_min: emptyToNull(values.bir_min),
        bir_serial_number: emptyToNull(values.bir_serial_number),
        bir_ptu_number: emptyToNull(values.bir_ptu_number),
        bir_ptu_issued_on: emptyToNull(values.bir_ptu_issued_on),
      });
      toast.success(`Terminal ${device?.terminal_code ?? ""} updated`);
      onOpenChange(false);
    } catch (error) {
      if (!applyServerErrors(error, setError, FIELDS)) toast.error(errorMessage(error));
    }
  });

  return (
    <Dialog open={device !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit terminal {device?.terminal_code}</DialogTitle>
          <DialogDescription>BIR details print on receipts and X/Z readings after the terminal next syncs.</DialogDescription>
        </DialogHeader>
        <form id="device-form" onSubmit={onSubmit} className="grid gap-4" noValidate>
          <TextField label="Name" error={errors.name?.message} {...register("name")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Machine identification no. (MIN)" error={errors.bir_min?.message} {...register("bir_min")} />
            <TextField label="Serial number" error={errors.bir_serial_number?.message} {...register("bir_serial_number")} />
            <TextField label="PTU number" error={errors.bir_ptu_number?.message} {...register("bir_ptu_number")} />
            <TextField label="PTU issued on" type="date" error={errors.bir_ptu_issued_on?.message} {...register("bir_ptu_issued_on")} />
          </div>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="device-form" disabled={isSubmitting}>
            {isSubmitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
