"use client";

import { PrinterIcon, Trash2Icon } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

import { SelectField } from "@/components/shared/form-fields";
import { money } from "@/components/shared/formatters";
import { PageHeader } from "@/components/shared/page-header";
import { SearchInput } from "@/components/shared/search-input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useProduct, useProducts, useReference } from "@/features/catalog/api";
import { BarcodeSvg } from "@/features/products/components/barcode-svg";
import { expandLabels, fitName, LABEL_SIZES, type LabelItem, pageCss, paginate } from "@/features/products/labels";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { api } from "@/lib/api";
import type { Product } from "@/types/api-admin";

interface Row extends LabelItem {
  variantId: string;
}

function rowsFor(product: Product, defaultLevelId: string | undefined): Row[] {
  const base = product.units.find((u) => u.is_base);
  return product.variants
    .filter((v) => v.is_active)
    .map((v) => {
      const barcode = v.barcodes.find((b) => b.is_active && b.is_primary) ?? v.barcodes.find((b) => b.is_active);
      const price = v.prices.find(
        (p) =>
          p.is_active &&
          p.branch_id === null &&
          p.product_unit_id === base?.id &&
          p.price_level_id === defaultLevelId &&
          Number(p.min_quantity) === 1,
      );
      return {
        key: v.id,
        variantId: v.id,
        name: v.name ? `${product.name} ${v.name}` : product.name,
        code: barcode?.code ?? "",
        price: price ? money(price.price) : null,
        copies: 1,
      };
    });
}

function LabelsPageInner() {
  const params = useSearchParams();
  const { data: levels } = useReference("price-levels");
  const defaultLevelId = levels?.find((l) => l.is_default)?.id;
  const [rows, setRows] = useState<Row[]>([]);
  const [sizeId, setSizeId] = useState(LABEL_SIZES[0].id);
  const [showPrice, setShowPrice] = useState(true);
  const [search, setSearch] = useState("");
  const q = useDebouncedValue(search.trim());
  const results = useProducts({ q: q || undefined, limit: 8, offset: 0 });
  const size = LABEL_SIZES.find((s) => s.id === sizeId) ?? LABEL_SIZES[0];

  const addProduct = async (id: string) => {
    const product = await api.get<Product>(`/products/${id}`);
    setRows((current) => [...current, ...rowsFor(product, defaultLevelId).filter((r) => !current.some((c) => c.key === r.key))]);
  };

  // Seed the list once with the product from the URL (?product=id).
  const initial = useProduct(params.get("product"));
  const [seeded, setSeeded] = useState(false);
  if (!seeded && initial.data && defaultLevelId) {
    setSeeded(true);
    setRows(rowsFor(initial.data, defaultLevelId));
  }

  const labels = useMemo(
    () => expandLabels(rows.map((r) => ({ ...r, price: showPrice ? r.price : null }))),
    [rows, showPrice],
  );
  const pages = paginate(labels, size);

  return (
    <>
      <style>{`@media print { ${pageCss(size)} }`}</style>
      <div className="print:hidden">
        <PageHeader
          title="Barcode labels"
          description="Pick products, set copies, choose a label size and print."
          actions={
            <Button disabled={labels.length === 0} onClick={() => window.print()}>
              <PrinterIcon /> Print {labels.length} label{labels.length === 1 ? "" : "s"}
            </Button>
          }
        />
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <SearchInput value={search} onChange={setSearch} placeholder="Add products: name, SKU or barcode" className="sm:w-full" />
              {q && (results.data?.items.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-2">
                  {results.data?.items.map((p) => (
                    <Button key={p.id} size="sm" variant="outline" onClick={() => void addProduct(p.id)}>
                      + {p.name}
                    </Button>
                  ))}
                </div>
              )}
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">No items yet.</p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {rows.map((r) => (
                    <li key={r.key} className="flex items-center gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{r.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{r.code || "No barcode — generate one on the product page"}</p>
                      </div>
                      <Input
                        aria-label={`Copies of ${r.name}`}
                        className="h-8 w-20"
                        inputMode="numeric"
                        value={String(r.copies)}
                        onChange={(e) =>
                          setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, copies: Number.parseInt(e.target.value, 10) || 0 } : x)))
                        }
                      />
                      <Button variant="ghost" size="icon-sm" aria-label="Remove" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                        <Trash2Icon />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Layout</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <SelectField label="Label size" value={sizeId} onChange={setSizeId} options={LABEL_SIZES.map((s) => ({ value: s.id, label: s.name }))} />
              <div className="flex items-center gap-2">
                <Switch id="show-price" checked={showPrice} onCheckedChange={setShowPrice} />
                <Label htmlFor="show-price">Show price</Label>
              </div>
            </CardContent>
          </Card>
        </div>
        {labels.length > 0 && <h2 className="mt-6 mb-2 text-sm font-medium text-muted-foreground">Preview</h2>}
      </div>

      <div className="label-sheet space-y-4 print:space-y-0">
        {pages.map((page, index) => (
          <div
            key={index}
            className="flex flex-wrap content-start bg-white text-black shadow-sm print:shadow-none print:break-after-page"
            style={{
              width: `${size.sheet?.pageWidthMm ?? size.widthMm}mm`,
              minHeight: size.sheet ? `${size.sheet.pageHeightMm}mm` : `${size.heightMm}mm`,
            }}
          >
            {page.map((label) => (
              <div
                key={label.key}
                className="flex flex-col items-center justify-center overflow-hidden border border-dashed border-neutral-300 p-[1.5mm] text-center print:border-0"
                style={{ width: `${size.widthMm}mm`, height: `${size.heightMm}mm` }}
              >
                <p className="w-full truncate text-[8pt] leading-tight font-medium">{fitName(label.name, size.widthMm)}</p>
                <BarcodeSvg code={label.code} format={label.format} height={size.heightMm >= 30 ? 36 : 26} />
                {label.price && <p className="text-[9pt] leading-tight font-semibold">{label.price}</p>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

export default function LabelsPage() {
  return (
    <Suspense>
      <LabelsPageInner />
    </Suspense>
  );
}
