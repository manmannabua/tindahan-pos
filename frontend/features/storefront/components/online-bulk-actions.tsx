"use client";

import { ChevronDownIcon, EyeIcon, EyeOffIcon, GlobeIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSetProductsOnline } from "@/features/storefront/api";
import { errorMessage } from "@/lib/api/errors";
import type { ProductsOnlineUpdate } from "@/types/api-admin";

type Filter = NonNullable<ProductsOnlineUpdate["filter"]>;

function plural(n: number): string {
  return `${n} product${n === 1 ? "" : "s"}`;
}

/** "Show/Hide online" for the ticked rows. */
export function SelectedOnlineActions({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const setOnline = useSetProductsOnline();
  const apply = async (show: boolean) => {
    try {
      const { updated } = await setOnline.mutateAsync({ show_online: show, product_ids: ids });
      toast.success(`${plural(updated)} ${show ? "shown" : "hidden"} online`);
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <div className="bg-muted/60 mb-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm">
      <span className="font-medium">{ids.length} selected</span>
      <Button size="sm" variant="outline" disabled={setOnline.isPending} onClick={() => void apply(true)}>
        <EyeIcon /> Show online
      </Button>
      <Button size="sm" variant="outline" disabled={setOnline.isPending} onClick={() => void apply(false)}>
        <EyeOffIcon /> Hide online
      </Button>
      <Button size="sm" variant="ghost" onClick={onDone}>
        Clear
      </Button>
    </div>
  );
}

/** Show/hide every product matching the current list filter (all pages), after confirmation. */
export function FilterOnlineMenu({ filter, total }: { filter: Filter; total: number }) {
  const setOnline = useSetProductsOnline();
  const [pending, setPending] = useState<boolean | null>(null);
  const confirm = async () => {
    if (pending === null) return;
    try {
      const { updated } = await setOnline.mutateAsync({ show_online: pending, filter });
      toast.success(`${plural(updated)} ${pending ? "shown" : "hidden"} online`);
      setPending(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" disabled={total === 0} />}>
          <GlobeIcon /> Online <ChevronDownIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => setPending(true)}>
            <EyeIcon /> Show all {total} matching online
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setPending(false)}>
            <EyeOffIcon /> Hide all {total} matching online
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending ? "Show products online?" : "Hide products online?"}
        description={
          pending
            ? `All ${plural(total)} matching the current search and filters will appear in your public online catalog.`
            : `All ${plural(total)} matching the current search and filters will be removed from your public online catalog.`
        }
        confirmLabel={pending ? "Show online" : "Hide online"}
        pending={setOnline.isPending}
        onConfirm={() => void confirm()}
      />
    </>
  );
}
