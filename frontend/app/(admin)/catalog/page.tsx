"use client";

import { BadgePercentIcon, CreditCardIcon, RulerIcon, TagIcon, TagsIcon } from "lucide-react";

import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissionInAnyScope } from "@/features/auth/hooks";
import { CategoryManager } from "@/features/catalog/components/category-manager";
import { ReferenceManager } from "@/features/catalog/components/reference-manager";
import { ADMIN_PERM } from "@/features/shell/permissions";

const TAX_KINDS = [
  { value: "VATABLE", label: "VATable" },
  { value: "EXEMPT", label: "VAT exempt" },
  { value: "ZERO_RATED", label: "Zero-rated" },
];

const PAYMENT_KINDS = [
  { value: "CASH", label: "Cash" },
  { value: "EWALLET", label: "E-wallet (GCash, Maya)" },
  { value: "CARD", label: "Card" },
  { value: "BANK", label: "Bank transfer" },
  { value: "OTHER", label: "Other" },
];

export default function CatalogSetupPage() {
  const canEditProducts = usePermissionInAnyScope(ADMIN_PERM.PRODUCTS_WRITE);
  const canEditPrices = usePermissionInAnyScope(ADMIN_PERM.PRICES_WRITE);
  const canEditSettings = usePermissionInAnyScope(ADMIN_PERM.SETTINGS_MANAGE);

  return (
    <>
      <PageHeader title="Catalog setup" description="Categories, brands, units, taxes, price levels and payment methods." />
      <Tabs defaultValue="categories">
        <TabsList className="mb-4 flex-wrap">
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="brands">Brands</TabsTrigger>
          <TabsTrigger value="units">Units</TabsTrigger>
          <TabsTrigger value="tax-rates">Tax rates</TabsTrigger>
          <TabsTrigger value="price-levels">Price levels</TabsTrigger>
          <TabsTrigger value="payment-methods">Payment methods</TabsTrigger>
        </TabsList>
        <TabsContent value="categories">
          <CategoryManager canEdit={canEditProducts} />
        </TabsContent>
        <TabsContent value="brands">
          <ReferenceManager
            kind="brands"
            noun="brand"
            icon={TagIcon}
            canEdit={canEditProducts}
            columns={[{ label: "Name", render: (b) => b.name }]}
            fields={[{ name: "name", label: "Name", kind: "text", required: true }]}
          />
        </TabsContent>
        <TabsContent value="units">
          <ReferenceManager
            kind="units"
            noun="unit"
            icon={RulerIcon}
            canEdit={canEditProducts}
            columns={[
              { label: "Code", render: (u) => <span className="font-mono">{u.code}</span>, className: "w-28" },
              { label: "Name", render: (u) => u.name },
              { label: "Decimals", render: (u) => (u.allows_decimal ? "Allowed" : "Whole units"), className: "hidden sm:table-cell" },
            ]}
            fields={[
              { name: "code", label: "Code (e.g. PC, KG)", kind: "text", upper: true, createOnly: true, required: true },
              { name: "name", label: "Name", kind: "text", required: true },
              { name: "allows_decimal", label: "Allow fractional quantities", kind: "switch" },
            ]}
          />
        </TabsContent>
        <TabsContent value="tax-rates">
          <ReferenceManager
            kind="tax-rates"
            noun="tax rate"
            icon={BadgePercentIcon}
            canEdit={canEditSettings}
            columns={[
              { label: "Code", render: (t) => <span className="font-mono">{t.code}</span>, className: "w-32" },
              {
                label: "Name",
                render: (t) => (
                  <span className="flex items-center gap-2">
                    {t.name}
                    {t.is_default && <Badge variant="secondary">Default</Badge>}
                  </span>
                ),
              },
              { label: "Rate", render: (t) => `${t.rate}%`, className: "w-24 tabular-nums" },
              { label: "Kind", render: (t) => TAX_KINDS.find((k) => k.value === t.kind)?.label ?? t.kind, className: "hidden sm:table-cell" },
            ]}
            fields={[
              { name: "code", label: "Code", kind: "text", upper: true, createOnly: true, required: true },
              { name: "name", label: "Name", kind: "text", required: true },
              { name: "rate", label: "Rate (%)", kind: "decimal" },
              { name: "kind", label: "Kind", kind: "select", options: TAX_KINDS },
              { name: "is_default", label: "Default for new products", kind: "switch" },
            ]}
          />
        </TabsContent>
        <TabsContent value="price-levels">
          <ReferenceManager
            kind="price-levels"
            noun="price level"
            icon={TagsIcon}
            canEdit={canEditPrices}
            columns={[
              { label: "Code", render: (l) => <span className="font-mono">{l.code}</span>, className: "w-32" },
              {
                label: "Name",
                render: (l) => (
                  <span className="flex items-center gap-2">
                    {l.name}
                    {l.is_default && <Badge variant="secondary">Default</Badge>}
                  </span>
                ),
              },
              { label: "Order", render: (l) => l.sort_order, className: "w-20" },
            ]}
            fields={[
              { name: "code", label: "Code", kind: "text", upper: true, createOnly: true, required: true },
              { name: "name", label: "Name", kind: "text", required: true },
              { name: "sort_order", label: "Sort order", kind: "decimal" },
              { name: "is_default", label: "Default price level", kind: "switch", editOnly: true },
            ]}
          />
        </TabsContent>
        <TabsContent value="payment-methods">
          <ReferenceManager
            kind="payment-methods"
            noun="payment method"
            icon={CreditCardIcon}
            canEdit={canEditSettings}
            columns={[
              { label: "Code", render: (m) => <span className="font-mono">{m.code}</span>, className: "w-36" },
              { label: "Name", render: (m) => m.name },
              { label: "Kind", render: (m) => PAYMENT_KINDS.find((k) => k.value === m.kind)?.label ?? m.kind, className: "hidden sm:table-cell" },
              { label: "Reference", render: (m) => (m.requires_reference ? "Required" : "—"), className: "hidden md:table-cell" },
            ]}
            fields={[
              { name: "code", label: "Code", kind: "text", upper: true, createOnly: true, required: true },
              { name: "name", label: "Name", kind: "text", required: true },
              { name: "kind", label: "Kind", kind: "select", options: PAYMENT_KINDS, createOnly: true },
              { name: "requires_reference", label: "Requires a reference number", kind: "switch" },
              { name: "opens_drawer", label: "Opens the cash drawer", kind: "switch" },
              { name: "sort_order", label: "Sort order", kind: "decimal" },
            ]}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
