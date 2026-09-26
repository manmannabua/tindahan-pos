"use client";

import { ContactIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { SelectField, TextAreaField, TextField } from "@/components/shared/form-fields";
import { money } from "@/components/shared/formatters";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { SearchInput } from "@/components/shared/search-input";
import { ActiveBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { CurrencyField } from "@/components/shared/currency-input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePermissionInAnyScope } from "@/features/auth/hooks";
import { useLabels, useReference } from "@/features/catalog/api";
import { useCustomers, useSaveCustomer } from "@/features/customers/api";
import { ADMIN_PERM } from "@/features/shell/permissions";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/api/errors";
import type { Customer } from "@/types/api-admin";

const PAGE_SIZE = 25;
const NONE = "__none__";

export default function CustomersPage() {
  const canWrite = usePermissionInAnyScope(ADMIN_PERM.CUSTOMERS_WRITE);
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<Customer | "new" | null>(null);
  const q = useDebouncedValue(search.trim());
  const levels = useLabels("price-levels", (l) => l.name);
  const { data, isPending, error, refetch } = useCustomers({ q: q || undefined, include_inactive: includeInactive, limit: PAGE_SIZE, offset });

  return (
    <>
      <PageHeader
        title="Customers"
        description="Customers can also be created at the POS, even offline."
        actions={
          canWrite && (
            <Button onClick={() => setEditing("new")}>
              <PlusIcon /> New customer
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput value={search} onChange={(v) => { setSearch(v); setOffset(0); }} placeholder="Search name, phone, email or code" />
        <div className="flex items-center gap-2">
          <Switch id="inactive-customers" checked={includeInactive} onCheckedChange={(v) => { setIncludeInactive(v); setOffset(0); }} />
          <Label htmlFor="inactive-customers">Show inactive</Label>
        </div>
      </div>
      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={ContactIcon} title="No customers found" />
      ) : (
        <>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">Phone</TableHead>
                  <TableHead className="hidden md:table-cell">Email</TableHead>
                  <TableHead className="hidden lg:table-cell">Price level</TableHead>
                  <TableHead className="hidden lg:table-cell text-right">Credit limit</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  {canWrite && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((c) => (
                  <TableRow key={c.id} className="h-11">
                    <TableCell className="font-medium">
                      {c.name} {c.code && <span className="ml-1 font-mono text-xs text-muted-foreground">{c.code}</span>}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{c.phone ?? "—"}</TableCell>
                    <TableCell className="hidden md:table-cell">{c.email ?? "—"}</TableCell>
                    <TableCell className="hidden lg:table-cell">{c.price_level_id ? (levels[c.price_level_id] ?? "—") : "Default"}</TableCell>
                    <TableCell className="hidden text-right tabular-nums lg:table-cell">{money(c.credit_limit)}</TableCell>
                    <TableCell>
                      <ActiveBadge active={c.is_active} />
                    </TableCell>
                    {canWrite && (
                      <TableCell>
                        <Button variant="ghost" size="icon-sm" aria-label="Edit customer" onClick={() => setEditing(c)}>
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
      {editing !== null && (
        <CustomerDialog key={editing === "new" ? "new" : editing.id} customer={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

/** Mounted fresh for each open (keyed), so initial state comes straight from the customer. */
function CustomerDialog({ customer, onClose }: { customer?: Customer; onClose: () => void }) {
  const save = useSaveCustomer();
  const { data: priceLevels } = useReference("price-levels");
  const [v, setV] = useState({
    name: customer?.name ?? "",
    code: customer?.code ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    address: customer?.address ?? "",
    tin: customer?.tin ?? "",
    priceLevelId: customer?.price_level_id ?? NONE,
    creditLimit: customer?.credit_limit ?? "",
    notes: customer?.notes ?? "",
    active: customer?.is_active ?? true,
  });
  const set = (key: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV({ ...v, [key]: e.target.value });

  const submit = async () => {
    if (v.creditLimit.trim() && !/^\d+(\.\d{1,2})?$/.test(v.creditLimit.trim())) {
      toast.error("Credit limit must be an amount like 5000.00");
      return;
    }
    const opt = (s: string) => s.trim() || null;
    const data = {
      name: v.name.trim(),
      code: opt(v.code),
      phone: opt(v.phone),
      email: opt(v.email),
      address: opt(v.address),
      tin: opt(v.tin),
      price_level_id: v.priceLevelId === NONE ? null : v.priceLevelId,
      credit_limit: opt(v.creditLimit),
      notes: opt(v.notes),
    };
    try {
      await save.mutateAsync(customer ? { id: customer.id, data: { ...data, is_active: v.active } } : { data });
      toast.success(customer ? "Customer updated" : "Customer created");
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{customer ? `Edit ${customer.name}` : "New customer"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
            <TextField label="Name" value={v.name} onChange={set("name")} />
            <TextField label="Code" value={v.code} onChange={set("code")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Phone" type="tel" value={v.phone} onChange={set("phone")} />
            <TextField label="Email" type="email" value={v.email} onChange={set("email")} />
            <TextField label="TIN" value={v.tin} onChange={set("tin")} />
            <CurrencyField label="Credit limit" value={v.creditLimit} onValueChange={(creditLimit) => setV({ ...v, creditLimit })} />
          </div>
          <TextField label="Address" value={v.address} onChange={set("address")} />
          <SelectField
            label="Price level"
            value={v.priceLevelId}
            onChange={(id) => setV({ ...v, priceLevelId: id })}
            options={[{ value: NONE, label: "Default" }, ...(priceLevels ?? []).map((l) => ({ value: l.id, label: l.name }))]}
          />
          <TextAreaField label="Notes" rows={2} value={v.notes} onChange={set("notes")} />
          {customer && (
            <div className="flex items-center gap-2">
              <Switch id="customer-active" checked={v.active} onCheckedChange={(active) => setV({ ...v, active })} />
              <Label htmlFor="customer-active">Active</Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={save.isPending || !v.name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
