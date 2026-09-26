"use client";

import { FolderTreeIcon, PencilIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
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
import type { Category } from "@/types/api-admin";

import { useCategories, useSaveCategory } from "../api";
import { descendantIds, flattenCategories } from "../category-tree";

const ROOT = "__root__";

export function CategoryManager({ canEdit }: { canEdit: boolean }) {
  const { data, isPending, error, refetch } = useCategories();
  const [editing, setEditing] = useState<Category | "new" | null>(null);

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setEditing("new")}>
            <PlusIcon /> New category
          </Button>
        </div>
      )}
      {isPending ? (
        <TableSkeleton rows={3} />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <EmptyState icon={FolderTreeIcon} title="No categories yet" />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-20">Order</TableHead>
                <TableHead className="w-24">Status</TableHead>
                {canEdit && <TableHead className="w-12" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {flattenCategories(data).map(({ category, depth }) => (
                <TableRow key={category.id} className="h-11">
                  <TableCell>
                    <span style={{ paddingLeft: `${depth * 1.25}rem` }}>
                      {depth > 0 && <span className="mr-1 text-muted-foreground">└</span>}
                      {category.name}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums">{category.sort_order}</TableCell>
                  <TableCell>
                    <ActiveBadge active={category.is_active} />
                  </TableCell>
                  {canEdit && (
                    <TableCell>
                      <Button variant="ghost" size="icon-sm" aria-label="Edit category" onClick={() => setEditing(category)}>
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
      <CategoryDialog
        categories={data ?? []}
        category={editing === "new" ? undefined : (editing ?? undefined)}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      />
    </div>
  );
}

function CategoryDialog({
  categories,
  category,
  open,
  onOpenChange,
}: {
  categories: Category[];
  category?: Category;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const save = useSaveCategory();
  const [name, setName] = useState("");
  const [parent, setParent] = useState(ROOT);
  const [order, setOrder] = useState("0");
  const [active, setActive] = useState(true);

  // Reset the form each time the dialog opens (or targets another category).
  const [openedFor, setOpenedFor] = useState<Category | "new" | null>(null);
  const target = open ? (category ?? "new") : null;
  if (target !== openedFor) {
    setOpenedFor(target);
    if (target !== null) {
      setName(category?.name ?? "");
      setParent(category?.parent_id ?? ROOT);
      setOrder(String(category?.sort_order ?? 0));
      setActive(category?.is_active ?? true);
    }
  }

  const blocked = category ? descendantIds(categories, category.id) : new Set<string>();
  const options = [
    { value: ROOT, label: "— Top level —" },
    ...flattenCategories(categories)
      .filter((n) => !blocked.has(n.category.id))
      .map((n) => ({ value: n.category.id, label: n.path })),
  ];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      name: name.trim(),
      parent_id: parent === ROOT ? null : parent,
      sort_order: Number.parseInt(order, 10) || 0,
      ...(category ? { is_active: active } : {}),
    };
    try {
      await save.mutateAsync({ id: category?.id, data });
      toast.success(category ? "Category updated" : "Category created");
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{category ? "Edit category" : "New category"}</DialogTitle>
        </DialogHeader>
        <form id="category-form" onSubmit={submit} className="grid gap-4">
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <SelectField label="Parent" value={parent} onChange={setParent} options={options} />
          <TextField label="Sort order" inputMode="numeric" value={order} onChange={(e) => setOrder(e.target.value)} />
          {category && (
            <div className="flex items-center gap-2">
              <Switch id="category-active" checked={active} onCheckedChange={setActive} />
              <Label htmlFor="category-active">Active</Label>
            </div>
          )}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="category-form" disabled={save.isPending || name.trim() === ""}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
