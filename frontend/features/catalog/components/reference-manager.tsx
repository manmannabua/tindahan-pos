"use client";

import { PencilIcon, PlusIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { SelectField, TextField } from "@/components/shared/form-fields";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { ActiveBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage } from "@/lib/api/errors";
import { applyServerErrors } from "@/lib/forms";
import type { LucideIcon } from "lucide-react";

import { type ReferenceKind, type ReferenceRowMap, useReference, useSaveReference } from "../api";

export type FieldSpec =
  | { name: string; label: string; kind: "text"; upper?: boolean; createOnly?: boolean; required?: boolean }
  | { name: string; label: string; kind: "decimal"; createOnly?: boolean }
  | { name: string; label: string; kind: "switch"; createOnly?: boolean; editOnly?: boolean }
  | { name: string; label: string; kind: "select"; options: { value: string; label: string }[]; createOnly?: boolean };

export interface ColumnSpec<Row> {
  label: string;
  render: (row: Row) => React.ReactNode;
  className?: string;
}

interface ReferenceManagerProps<K extends ReferenceKind> {
  kind: K;
  noun: string;
  icon: LucideIcon;
  columns: ColumnSpec<ReferenceRowMap[K]>[];
  fields: FieldSpec[];
  canEdit: boolean;
}

type Values = Record<string, string | boolean>;

function defaults(fields: FieldSpec[], row?: Record<string, unknown>): Values {
  return Object.fromEntries(
    fields.map((f) => {
      const current = row?.[f.name];
      if (f.kind === "switch") return [f.name, Boolean(current)];
      return [f.name, current === null || current === undefined ? "" : String(current)];
    }),
  );
}

export function ReferenceManager<K extends ReferenceKind>({ kind, noun, icon, columns, fields, canEdit }: ReferenceManagerProps<K>) {
  const { data, isPending, error, refetch } = useReference(kind);
  const [editing, setEditing] = useState<ReferenceRowMap[K] | "new" | null>(null);

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setEditing("new")}>
            <PlusIcon /> New {noun}
          </Button>
        </div>
      )}
      {isPending ? (
        <TableSkeleton rows={3} />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <EmptyState icon={icon} title={`No ${noun}s yet`} />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((c) => (
                  <TableHead key={c.label} className={c.className}>
                    {c.label}
                  </TableHead>
                ))}
                <TableHead className="w-24">Status</TableHead>
                {canEdit && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((row) => (
                <TableRow key={row.id} className="h-11">
                  {columns.map((c) => (
                    <TableCell key={c.label} className={c.className}>
                      {c.render(row)}
                    </TableCell>
                  ))}
                  <TableCell>
                    <ActiveBadge active={row.is_active} />
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${noun}`} onClick={() => setEditing(row)}>
                        <PencilIcon />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <ReferenceDialog
        kind={kind}
        noun={noun}
        fields={fields}
        row={editing === "new" ? undefined : (editing ?? undefined)}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </div>
  );
}

interface ReferenceDialogProps {
  kind: ReferenceKind;
  noun: string;
  fields: FieldSpec[];
  row?: { id: string; is_active: boolean } & object;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function ReferenceDialog({ kind, noun, fields, row, open, onOpenChange }: ReferenceDialogProps) {
  const save = useSaveReference(kind);
  const editable = row ? fields.filter((f) => !f.createOnly) : fields.filter((f) => !("editOnly" in f && f.editOnly));
  const withStatus: FieldSpec[] = row ? [...editable, { name: "is_active", label: "Active", kind: "switch" }] : editable;
  const { register, control, handleSubmit, reset, setError, formState } = useForm<Values>({
    defaultValues: defaults(withStatus, row as Record<string, unknown> | undefined),
  });

  useEffect(() => {
    if (open) reset(defaults(withStatus, row as Record<string, unknown> | undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open, row]);

  const onSubmit = handleSubmit(async (values) => {
    const data: Record<string, unknown> = {};
    for (const f of withStatus) {
      const v = values[f.name];
      if (f.kind === "switch") data[f.name] = Boolean(v);
      else if (typeof v === "string") {
        const trimmed = f.kind === "text" && f.upper ? v.trim().toUpperCase() : v.trim();
        if (trimmed !== "") data[f.name] = trimmed;
      }
    }
    try {
      await save.mutateAsync({ id: row?.id, data });
      toast.success(row ? `${noun} updated` : `${noun} created`);
      onOpenChange(false);
    } catch (e) {
      if (!applyServerErrors(e, setError, withStatus.map((f) => f.name))) toast.error(errorMessage(e));
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{row ? `Edit ${noun}` : `New ${noun}`}</DialogTitle>
        </DialogHeader>
        <form id={`ref-${kind}`} onSubmit={onSubmit} className="grid gap-4" noValidate>
          {withStatus.map((f) => {
            const err = formState.errors[f.name]?.message;
            if (f.kind === "switch") {
              return (
                <Controller
                  key={f.name}
                  control={control}
                  name={f.name}
                  render={({ field }) => (
                    <div className="flex items-center gap-2">
                      <Switch id={`${kind}-${f.name}`} checked={Boolean(field.value)} onCheckedChange={field.onChange} />
                      <Label htmlFor={`${kind}-${f.name}`}>{f.label}</Label>
                    </div>
                  )}
                />
              );
            }
            if (f.kind === "select") {
              return (
                <Controller
                  key={f.name}
                  control={control}
                  name={f.name}
                  render={({ field }) => (
                    <SelectField label={f.label} value={String(field.value)} onChange={field.onChange} options={f.options} error={err} />
                  )}
                />
              );
            }
            return (
              <TextField
                key={f.name}
                label={f.label}
                inputMode={f.kind === "decimal" ? "decimal" : undefined}
                className={f.kind === "text" && f.upper ? "uppercase" : undefined}
                error={err}
                {...register(f.name, { required: f.kind === "text" && f.required ? "Required" : false })}
              />
            );
          })}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={`ref-${kind}`} disabled={formState.isSubmitting}>
            {formState.isSubmitting ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
