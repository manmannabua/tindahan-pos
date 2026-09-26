"use client";

import { PlusIcon, WalletIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { SelectField, SimpleSelect, TextField } from "@/components/shared/form-fields";
import { daysAgo, humanize, isoDate, money } from "@/components/shared/formatters";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CurrencyField } from "@/components/shared/currency-input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBranches, useBranchLabels } from "@/features/branches/api";
import { useCreateExpenseCategory, useExpenseCategories, useExpenses, useRecordExpense, useVoidExpense } from "@/features/management/api";
import { errorMessage } from "@/lib/api/errors";
import { toBig } from "@/lib/money";
import type { Expense, ExpenseCreate } from "@/types/api-admin";

const PAGE_SIZE = 50;
const ALL = "__all__";
const PAID_FROM = ["CASH_DRAWER", "PETTY_CASH", "BANK", "EWALLET", "OTHER"].map((v) => ({ value: v, label: humanize(v) }));

export default function ExpensesPage() {
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(isoDate(new Date()));
  const [categoryId, setCategoryId] = useState(ALL);
  const [offset, setOffset] = useState(0);
  const [recording, setRecording] = useState(false);
  const [voiding, setVoiding] = useState<Expense | null>(null);
  const { data: categories } = useExpenseCategories();
  const branches = useBranchLabels();
  const voidExpense = useVoidExpense();
  const { data, isPending, error, refetch } = useExpenses({
    date_from: from || undefined,
    date_to: to || undefined,
    category_id: categoryId === ALL ? undefined : categoryId,
    limit: PAGE_SIZE,
    offset,
  });
  const categoryName = Object.fromEntries((categories ?? []).map((c) => [c.id, c.name]));

  return (
    <>
      <PageHeader
        title="Expenses"
        actions={
          <Button onClick={() => setRecording(true)}>
            <PlusIcon /> Record expense
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end">
        <div className="w-40">
          <TextField label="From" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setOffset(0); }} />
        </div>
        <div className="w-40">
          <TextField label="To" type="date" value={to} onChange={(e) => { setTo(e.target.value); setOffset(0); }} />
        </div>
        <SimpleSelect
          aria-label="Category"
          className="w-full lg:w-56"
          value={categoryId}
          onChange={(v) => { setCategoryId(v); setOffset(0); }}
          options={[{ value: ALL, label: "All categories" }, ...(categories ?? []).map((c) => ({ value: c.id, label: c.name }))]}
        />
      </div>
      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={WalletIcon} title="No expenses in this period" />
      ) : (
        <>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="hidden md:table-cell">Branch</TableHead>
                  <TableHead className="hidden lg:table-cell">Paid from</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((e) => (
                  <TableRow key={e.id} className={e.voided_at ? "h-11 text-muted-foreground line-through" : "h-11"}>
                    <TableCell>{e.expense_date}</TableCell>
                    <TableCell>{categoryName[e.category_id] ?? "—"}</TableCell>
                    <TableCell>
                      {e.description}
                      {e.payee && <span className="text-muted-foreground"> · {e.payee}</span>}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{branches[e.branch_id] ?? "—"}</TableCell>
                    <TableCell className="hidden lg:table-cell">{humanize(e.paid_from)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(e.amount)}</TableCell>
                    <TableCell className="text-right">
                      {e.voided_at ? (
                        <Badge variant="outline">Voided</Badge>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setVoiding(e)}>
                          Void
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} shown={data.items.length} onChange={setOffset} />
        </>
      )}
      {recording && <ExpenseDialog onClose={() => setRecording(false)} />}
      <ConfirmDialog
        open={voiding !== null}
        onOpenChange={(v) => !v && setVoiding(null)}
        title="Void this expense?"
        description={voiding ? `${voiding.description} · ${money(voiding.amount)}` : ""}
        confirmLabel="Void"
        destructive
        pending={voidExpense.isPending}
        onConfirm={() =>
          voiding &&
          voidExpense.mutate(voiding.id, { onSuccess: () => setVoiding(null), onError: (e) => toast.error(errorMessage(e)) })
        }
      />
    </>
  );
}

const NEW_CATEGORY = "__new__";

function ExpenseDialog({ onClose }: { onClose: () => void }) {
  const record = useRecordExpense();
  const createCategory = useCreateExpenseCategory();
  const { data: branches } = useBranches();
  const { data: categories } = useExpenseCategories();
  const [branchId, setBranchId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [date, setDate] = useState(isoDate(new Date()));
  const [amount, setAmount] = useState("");
  const [paidFrom, setPaidFrom] = useState<ExpenseCreate["paid_from"]>("CASH_DRAWER");
  const [payee, setPayee] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    const branch = branchId || branches?.[0]?.id || "";
    if (!branch) return setProblem("Choose a branch.");
    if (!/^\d+(\.\d{1,2})?$/.test(amount.trim()) || toBig(amount.trim()).lte("0")) return setProblem("Enter an amount like 1520.75.");
    if (description.trim().length < 2) return setProblem("Describe the expense.");
    try {
      let category = categoryId;
      if (category === NEW_CATEGORY || !category) {
        if (!newCategory.trim()) return setProblem("Choose or create a category.");
        category = (await createCategory.mutateAsync(newCategory.trim())).id;
      }
      await record.mutateAsync({
        branch_id: branch,
        category_id: category,
        expense_date: date,
        amount: amount.trim(),
        paid_from: paidFrom,
        payee: payee.trim() || null,
        reference_no: reference.trim() || null,
        description: description.trim(),
      });
      toast.success("Expense recorded");
      onClose();
    } catch (e) {
      setProblem(errorMessage(e));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record expense</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="Branch"
              value={branchId || branches?.[0]?.id || ""}
              onChange={setBranchId}
              options={(branches ?? []).map((b) => ({ value: b.id, label: b.name }))}
            />
            <SelectField
              label="Category"
              value={categoryId}
              onChange={setCategoryId}
              placeholder="Select category"
              options={[...(categories ?? []).filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name })), { value: NEW_CATEGORY, label: "+ New category" }]}
            />
            {categoryId === NEW_CATEGORY && <TextField label="New category name" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />}
            <TextField label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            <CurrencyField label="Amount" value={amount} onValueChange={setAmount} />
            <SelectField label="Paid from" value={paidFrom} onChange={(v) => setPaidFrom(v as ExpenseCreate["paid_from"])} options={PAID_FROM} />
            <TextField label="Payee" value={payee} onChange={(e) => setPayee(e.target.value)} />
            <TextField label="Reference no." value={reference} onChange={(e) => setReference(e.target.value)} />
          </div>
          <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} />
          {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={record.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
