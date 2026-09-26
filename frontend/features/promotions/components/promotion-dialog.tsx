"use client";

import { XIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SelectField, SimpleSelect, TextField } from "@/components/shared/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CurrencyField } from "@/components/shared/currency-input";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useBranches } from "@/features/branches/api";
import { useCategories, useReference } from "@/features/catalog/api";
import { flattenCategories } from "@/features/catalog/category-tree";
import { ItemPicker } from "@/features/inventory/components/item-picker";
import { errorMessage } from "@/lib/api/errors";
import type { Promotion, PromotionCreate, PromotionKind } from "@/types/api-admin";

import { PROMOTION_KINDS, useSavePromotion, WEEKDAYS } from "../api";

type TargetType = PromotionCreate["targets"][number]["type"];
interface TargetDraft {
  type: TargetType;
  id: string | null;
  label: string;
}

const toLocalInput = (iso: string | null) => (iso ? iso.slice(0, 16) : "");
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

/** Mounted fresh for each open (keyed by the parent), so state initializes from `promotion`. */
export function PromotionDialog({ promotion, onClose }: { promotion?: Promotion; onClose: () => void }) {
  const save = useSavePromotion();
  const { data: categories } = useCategories();
  const { data: brands } = useReference("brands");
  const { data: branches } = useBranches();
  const [name, setName] = useState(promotion?.name ?? "");
  const [kind, setKind] = useState<PromotionKind>(promotion?.kind ?? "PERCENT_OFF");
  const [value, setValue] = useState(promotion ? String(Number(promotion.value)) : "");
  const [buy, setBuy] = useState(promotion?.buy_quantity ? String(Number(promotion.buy_quantity)) : "2");
  const [get, setGet] = useState(promotion?.get_quantity ? String(Number(promotion.get_quantity)) : "1");
  const [minQty, setMinQty] = useState(promotion ? String(Number(promotion.min_quantity)) : "1");
  const [targets, setTargets] = useState<TargetDraft[]>(
    (promotion?.targets ?? []).map((t) => ({
      type: t.type as TargetType,
      id: (t.id as string | undefined) ?? null,
      label: t.type === "ALL" ? "Everything" : String(t.id ?? "").slice(0, 8),
    })),
  );
  const [starts, setStarts] = useState(toLocalInput(promotion?.starts_at ?? null));
  const [ends, setEnds] = useState(toLocalInput(promotion?.ends_at ?? null));
  const [days, setDays] = useState<number[]>(promotion?.days_of_week ?? []);
  const [startTime, setStartTime] = useState(promotion?.start_time?.slice(0, 5) ?? "");
  const [endTime, setEndTime] = useState(promotion?.end_time?.slice(0, 5) ?? "");
  const [branchIds, setBranchIds] = useState<string[]>(promotion?.branch_ids ?? []);
  const [priority, setPriority] = useState(String(promotion?.priority ?? 0));
  const [active, setActive] = useState(promotion?.is_active ?? true);
  const [pickType, setPickType] = useState<TargetType>("CATEGORY");
  const [problem, setProblem] = useState<string | null>(null);

  const addTarget = (t: TargetDraft) =>
    setTargets((list) => (list.some((x) => x.type === t.type && x.id === t.id) ? list : [...list.filter((x) => x.type !== "ALL"), t]));

  const submit = async () => {
    const needsValue = kind !== "BUY_X_GET_Y";
    let invalid: string | null = null;
    if (name.trim().length < 2) invalid = "Give the promotion a name.";
    else if (needsValue && !/^\d+(\.\d{1,2})?$/.test(value.trim())) invalid = "Enter a value.";
    else if (kind === "PERCENT_OFF" && Number(value) > 100) invalid = "Percent can't exceed 100.";
    else if (kind === "BUY_X_GET_Y" && !(Number(buy) > 0 && Number(get) > 0)) invalid = "Enter buy and get quantities.";
    else if (targets.length === 0) invalid = "Choose what the promotion applies to.";
    else if (Boolean(startTime) !== Boolean(endTime)) invalid = "Set both start and end time, or neither.";
    setProblem(invalid);
    if (invalid) return;
    const data: PromotionCreate = {
      name: name.trim(),
      kind,
      value: needsValue ? value.trim() : "0",
      buy_quantity: kind === "BUY_X_GET_Y" ? buy.trim() : null,
      get_quantity: kind === "BUY_X_GET_Y" ? get.trim() : null,
      min_quantity: minQty.trim() || "1",
      targets: targets.map((t) => ({ type: t.type, id: t.id })),
      starts_at: fromLocalInput(starts),
      ends_at: fromLocalInput(ends),
      days_of_week: days.length ? [...days].sort() : null,
      start_time: startTime ? `${startTime}:00` : null,
      end_time: endTime ? `${endTime}:00` : null,
      branch_ids: branchIds.length ? branchIds : null,
      priority: Number.parseInt(priority, 10) || 0,
      is_active: active,
    };
    try {
      await save.mutateAsync({ id: promotion?.id, data });
      toast.success(promotion ? "Promotion updated" : "Promotion created");
      onClose();
    } catch (e) {
      setProblem(errorMessage(e));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{promotion ? "Edit promotion" : "New promotion"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <SelectField label="Kind" value={kind} onChange={(v) => setKind(v as PromotionKind)} options={[...PROMOTION_KINDS]} />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {kind === "BUY_X_GET_Y" ? (
              <>
                <TextField label="Buy" inputMode="decimal" value={buy} onChange={(e) => setBuy(e.target.value)} />
                <TextField label="Get free" inputMode="decimal" value={get} onChange={(e) => setGet(e.target.value)} />
              </>
            ) : kind === "PERCENT_OFF" ? (
              <TextField label="Percent" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
            ) : (
              <CurrencyField
                label={kind === "AMOUNT_OFF" ? "Amount off per unit" : "Special unit price"}
                value={value}
                onValueChange={setValue}
              />
            )}
            <TextField label="Minimum quantity" inputMode="decimal" value={minQty} onChange={(e) => setMinQty(e.target.value)} />
            <TextField label="Priority (higher wins)" inputMode="numeric" value={priority} onChange={(e) => setPriority(e.target.value)} />
          </div>

          <div className="space-y-2">
            <Label>Applies to</Label>
            <div className="flex flex-wrap gap-2">
              {targets.length === 0 && <span className="text-sm text-muted-foreground">Nothing selected</span>}
              {targets.map((t) => (
                <Badge key={`${t.type}-${t.id}`} variant="secondary" className="h-7 gap-1 pl-2">
                  {t.type === "ALL" ? "Everything" : `${t.type.toLowerCase()}: ${t.label}`}
                  <button type="button" aria-label="Remove target" onClick={() => setTargets((l) => l.filter((x) => x !== t))}>
                    <XIcon className="size-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
              <SimpleSelect
                aria-label="Target type"
                value={pickType}
                onChange={(v) => setPickType(v as TargetType)}
                options={[
                  { value: "CATEGORY", label: "Category" },
                  { value: "BRAND", label: "Brand" },
                  { value: "PRODUCT", label: "Product" },
                  { value: "VARIANT", label: "Variant" },
                  { value: "ALL", label: "Everything" },
                ]}
              />
              {pickType === "CATEGORY" && (
                <SimpleSelect
                  aria-label="Category"
                  placeholder="Add a category…"
                  value=""
                  onChange={(id) => addTarget({ type: "CATEGORY", id, label: flattenCategories(categories ?? []).find((n) => n.category.id === id)?.path ?? id })}
                  options={flattenCategories(categories ?? []).map((n) => ({ value: n.category.id, label: n.path }))}
                />
              )}
              {pickType === "BRAND" && (
                <SimpleSelect
                  aria-label="Brand"
                  placeholder="Add a brand…"
                  value=""
                  onChange={(id) => addTarget({ type: "BRAND", id, label: brands?.find((b) => b.id === id)?.name ?? id })}
                  options={(brands ?? []).map((b) => ({ value: b.id, label: b.name }))}
                />
              )}
              {(pickType === "PRODUCT" || pickType === "VARIANT") && (
                <ItemPicker
                  placeholder={`Add a ${pickType.toLowerCase()} (search or scan)`}
                  onPick={(item) =>
                    addTarget(
                      pickType === "PRODUCT"
                        ? { type: "PRODUCT", id: item.productId, label: item.name.split(" · ")[0] }
                        : { type: "VARIANT", id: item.variantId, label: `${item.name} (${item.sku})` },
                    )
                  }
                />
              )}
              {pickType === "ALL" && (
                <Button variant="outline" onClick={() => setTargets([{ type: "ALL", id: null, label: "Everything" }])}>
                  Apply to everything
                </Button>
              )}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Starts" type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
            <TextField label="Ends" type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
            <TextField label="Daily from" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            <TextField label="Daily until" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Days (none = every day)</legend>
            <div className="flex flex-wrap gap-3">
              {WEEKDAYS.map((label, i) => (
                <label key={label} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={days.includes(i + 1)}
                    onCheckedChange={(checked) => setDays((d) => (checked ? [...d, i + 1] : d.filter((x) => x !== i + 1)))}
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Branches (none = all branches)</legend>
            <div className="flex flex-wrap gap-3">
              {(branches ?? []).map((b) => (
                <label key={b.id} className="flex items-center gap-1.5 text-sm">
                  <Checkbox
                    checked={branchIds.includes(b.id)}
                    onCheckedChange={(checked) => setBranchIds((ids) => (checked ? [...ids, b.id] : ids.filter((x) => x !== b.id)))}
                  />
                  {b.name}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex items-center gap-2">
            <Switch id="promotion-active" checked={active} onCheckedChange={setActive} />
            <Label htmlFor="promotion-active">Active</Label>
          </div>
          {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
