"use client";

import { PencilIcon, PlusIcon, TruckIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { TextAreaField, TextField } from "@/components/shared/form-fields";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { SearchInput } from "@/components/shared/search-input";
import { ActiveBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePermissionInAnyScope } from "@/features/auth/hooks";
import { useSaveSupplier, useSuppliers } from "@/features/purchasing/api";
import { ADMIN_PERM } from "@/features/shell/permissions";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/api/errors";
import type { Supplier } from "@/types/api-admin";

const PAGE_SIZE = 25;

export default function SuppliersPage() {
  const canManage = usePermissionInAnyScope(ADMIN_PERM.SUPPLIERS_MANAGE);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const q = useDebouncedValue(search.trim());
  const { data, isPending, error, refetch } = useSuppliers({ q: q || undefined, include_inactive: true, limit: PAGE_SIZE, offset });

  return (
    <>
      <PageHeader
        title="Suppliers"
        actions={
          canManage && (
            <Button onClick={() => setEditing("new")}>
              <PlusIcon /> New supplier
            </Button>
          )
        }
      />
      <div className="mb-4">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setOffset(0); }} placeholder="Search name or code" />
      </div>
      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={TruckIcon} title="No suppliers" />
      ) : (
        <>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden md:table-cell">Contact</TableHead>
                  <TableHead className="hidden lg:table-cell">Terms</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  {canManage && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((s) => (
                  <TableRow key={s.id} className="h-11">
                    <TableCell className="font-mono">{s.code}</TableCell>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">
                      {[s.contact_person, s.phone, s.email].filter(Boolean).join(" · ") || "—"}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">{s.payment_terms_days ? `${s.payment_terms_days} days` : "Cash"}</TableCell>
                    <TableCell>
                      <ActiveBadge active={s.is_active} />
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <Button variant="ghost" size="icon-sm" aria-label="Edit supplier" onClick={() => setEditing(s)}>
                          <PencilIcon />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} shown={data.items.length} onChange={setOffset} />
        </>
      )}
      <SupplierDialog supplier={editing === "new" ? undefined : (editing ?? undefined)} open={editing !== null} onOpenChange={(v) => !v && setEditing(null)} />
    </>
  );
}

const FIELDS = ["code", "name", "contact_person", "phone", "email", "address", "tin", "payment_terms_days", "notes"] as const;
type Values = Record<(typeof FIELDS)[number], string>;

function SupplierDialog({ supplier, open, onOpenChange }: { supplier?: Supplier; open: boolean; onOpenChange: (v: boolean) => void }) {
  const save = useSaveSupplier();
  const [values, setValues] = useState<Values>({} as Values);
  const [active, setActive] = useState(true);

  // Reset the form each time the dialog opens (or targets another supplier).
  const [openedFor, setOpenedFor] = useState<Supplier | "new" | null>(null);
  const target = open ? (supplier ?? "new") : null;
  if (target !== openedFor) {
    setOpenedFor(target);
    if (target !== null) {
    setValues(Object.fromEntries(FIELDS.map((f) => [f, supplier?.[f] === null || supplier?.[f] === undefined ? "" : String(supplier[f])])) as Values);
    setActive(supplier?.is_active ?? true);
    }
  }

  const set = (key: keyof Values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValues({ ...values, [key]: e.target.value });
  const submit = async () => {
    const opt = (v: string) => v.trim() || null;
    const common = {
      name: values.name.trim(),
      contact_person: opt(values.contact_person),
      phone: opt(values.phone),
      email: opt(values.email),
      address: opt(values.address),
      tin: opt(values.tin),
      payment_terms_days: Number.parseInt(values.payment_terms_days, 10) || 0,
      notes: opt(values.notes),
    };
    try {
      await save.mutateAsync(
        supplier ? { id: supplier.id, data: { ...common, is_active: active } } : { data: { ...common, code: values.code.trim().toUpperCase() } },
      );
      toast.success(supplier ? "Supplier updated" : "Supplier created");
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{supplier ? `Edit ${supplier.name}` : "New supplier"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[9rem_1fr]">
            <TextField label="Code" className="uppercase" disabled={Boolean(supplier)} value={values.code ?? ""} onChange={set("code")} />
            <TextField label="Name" value={values.name ?? ""} onChange={set("name")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Contact person" value={values.contact_person ?? ""} onChange={set("contact_person")} />
            <TextField label="Phone" value={values.phone ?? ""} onChange={set("phone")} />
            <TextField label="Email" type="email" value={values.email ?? ""} onChange={set("email")} />
            <TextField label="TIN" value={values.tin ?? ""} onChange={set("tin")} />
          </div>
          <TextField label="Address" value={values.address ?? ""} onChange={set("address")} />
          <TextField label="Payment terms (days)" inputMode="numeric" value={values.payment_terms_days ?? ""} onChange={set("payment_terms_days")} />
          <TextAreaField label="Notes" rows={2} value={values.notes ?? ""} onChange={set("notes")} />
          {supplier && (
            <div className="flex items-center gap-2">
              <Switch id="supplier-active" checked={active} onCheckedChange={setActive} />
              <Label htmlFor="supplier-active">Active</Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={save.isPending || !values.name?.trim() || (!supplier && !values.code?.trim())}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
