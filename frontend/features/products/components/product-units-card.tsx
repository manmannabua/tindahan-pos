"use client";

import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { SimpleSelect } from "@/components/shared/form-fields";
import { qty } from "@/components/shared/formatters";
import { ActiveBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAddProductUnit, useReference, useUpdateProductUnit } from "@/features/catalog/api";
import { errorMessage } from "@/lib/api/errors";
import type { Product } from "@/types/api-admin";

export function ProductUnitsCard({ product, canEdit }: { product: Product; canEdit: boolean }) {
  const { data: units } = useReference("units");
  const add = useAddProductUnit(product.id);
  const updateUnit = useUpdateProductUnit();
  const [unitId, setUnitId] = useState("");
  const [factor, setFactor] = useState("");
  const [editing, setEditing] = useState<Record<string, string>>({});
  const used = new Set(product.units.filter((u) => u.is_active).map((u) => u.unit_id));
  const base = product.units.find((u) => u.is_base);

  const onError = (e: unknown) => toast.error(errorMessage(e));
  const addUnit = () =>
    add.mutate(
      { unit_id: unitId, factor: factor.trim() },
      {
        onSuccess: () => {
          setUnitId("");
          setFactor("");
          toast.success("Unit added");
        },
        onError,
      },
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Units</CardTitle>
        <CardDescription>Stock is kept in the base unit ({base?.unit_code}). Factor = base units per unit.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Unit</TableHead>
              <TableHead className="w-40">Factor</TableHead>
              <TableHead className="w-24">Status</TableHead>
              {canEdit && <TableHead className="w-44" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {product.units.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <span className="font-mono">{u.unit_code}</span> · {u.unit_name} {u.is_base && <Badge variant="secondary">Base</Badge>}
                </TableCell>
                <TableCell>
                  {canEdit && !u.is_base && editing[u.id] !== undefined ? (
                    <Input
                      aria-label={`Factor for ${u.unit_code}`}
                      className="h-8"
                      value={editing[u.id]}
                      onChange={(e) => setEditing({ ...editing, [u.id]: e.target.value })}
                    />
                  ) : (
                    <span className="tabular-nums">{qty(u.factor)}</span>
                  )}
                </TableCell>
                <TableCell>
                  <ActiveBadge active={u.is_active} />
                </TableCell>
                {canEdit && (
                  <TableCell className="space-x-1 text-right">
                    {!u.is_base &&
                      (editing[u.id] !== undefined ? (
                        <Button
                          size="sm"
                          onClick={() =>
                            updateUnit.mutate(
                              { id: u.id, data: { factor: editing[u.id].trim() } },
                              {
                                onSuccess: () => {
                                  const { [u.id]: _, ...rest } = editing;
                                  setEditing(rest);
                                },
                                onError,
                              },
                            )
                          }
                        >
                          Save
                        </Button>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" onClick={() => setEditing({ ...editing, [u.id]: qty(u.factor) })}>
                            Factor
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => updateUnit.mutate({ id: u.id, data: { is_active: !u.is_active } }, { onError })}
                          >
                            {u.is_active ? "Disable" : "Enable"}
                          </Button>
                        </>
                      ))}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {canEdit && (
          <div className="grid grid-cols-[1fr_8rem_auto] gap-2">
            <SimpleSelect
              aria-label="Unit to add"
              placeholder="Add a unit…"
              value={unitId}
              onChange={setUnitId}
              options={(units ?? []).filter((u) => u.is_active && !used.has(u.id)).map((u) => ({ value: u.id, label: `${u.code} · ${u.name}` }))}
            />
            <Input aria-label="Factor" placeholder="Factor" inputMode="decimal" value={factor} onChange={(e) => setFactor(e.target.value)} />
            <Button variant="outline" disabled={!unitId || !factor.trim() || add.isPending} onClick={addUnit}>
              <PlusIcon /> Add
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
