"use client";

import { useState } from "react";

import { PageHeader } from "@/components/shared/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissionInAnyScope } from "@/features/auth/hooks";
import { AdjustmentsView } from "@/features/inventory/components/adjustments-view";
import { BalancesView } from "@/features/inventory/components/balances-view";
import { InitialStockForm } from "@/features/inventory/components/initial-stock-form";
import { MovementsView } from "@/features/inventory/components/movements-view";
import { ADMIN_PERM } from "@/features/shell/permissions";

export default function InventoryPage() {
  const [tab, setTab] = useState("balances");
  const [variantId, setVariantId] = useState<string | null>(null);
  const canAdjust = usePermissionInAnyScope(ADMIN_PERM.INVENTORY_ADJUST);

  return (
    <>
      <PageHeader title="Stock" description="Balances are computed from the append-only inventory ledger." />
      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="balances">Balances</TabsTrigger>
          <TabsTrigger value="movements">Ledger</TabsTrigger>
          <TabsTrigger value="adjustments">Adjustments</TabsTrigger>
          {canAdjust && <TabsTrigger value="initial">Initial stock</TabsTrigger>}
        </TabsList>
        <TabsContent value="balances">
          <BalancesView
            onShowMovements={(id) => {
              setVariantId(id);
              setTab("movements");
            }}
          />
        </TabsContent>
        <TabsContent value="movements">
          <MovementsView variantId={variantId} onClearVariant={() => setVariantId(null)} />
        </TabsContent>
        <TabsContent value="adjustments">
          <AdjustmentsView canAdjust={canAdjust} />
        </TabsContent>
        {canAdjust && (
          <TabsContent value="initial">
            <InitialStockForm />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
