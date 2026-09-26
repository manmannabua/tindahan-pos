"use client";

import { TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { errorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/format";
import type { Device } from "@/types/api";

import { useRevokeDevice } from "../api";

/**
 * Revoking a terminal that still holds unsynced sales loses those sales from the central
 * database (docs/DEVICE_MANAGEMENT.md §5), so the dialog surfaces the last reported state.
 */
export function RevokeDeviceDialog({ device, onOpenChange }: { device: Device | null; onOpenChange: (open: boolean) => void }) {
  const revoke = useRevokeDevice();
  const pending = device?.pending_operations ?? null;

  return (
    <ConfirmDialog
      open={device !== null}
      onOpenChange={onOpenChange}
      title={`Revoke terminal ${device?.terminal_code ?? ""}?`}
      description={
        <div className="space-y-3">
          <p>
            The terminal will immediately stop syncing and cashiers can no longer sign in on it online. This cannot
            be undone — a replacement terminal must be registered.
          </p>
          <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1 text-sm">
              <p>
                Last sync: <strong>{formatDateTime(device?.last_sync_at)}</strong>. Pending operations last reported:{" "}
                <strong>{pending ?? "unknown"}</strong>.
              </p>
              <p>
                Unsynced sales on this terminal will be lost from central records. For a planned replacement, let it
                sync first.
              </p>
            </div>
          </div>
        </div>
      }
      confirmLabel="Revoke terminal"
      destructive
      pending={revoke.isPending}
      onConfirm={() =>
        device &&
        revoke.mutate(device.id, {
          onSuccess: () => {
            toast.success(`Terminal ${device.terminal_code} revoked`);
            onOpenChange(false);
          },
          onError: (e) => toast.error(errorMessage(e)),
        })
      }
    />
  );
}
