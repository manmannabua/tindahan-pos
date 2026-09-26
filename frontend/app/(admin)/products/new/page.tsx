"use client";

import { PageHeader } from "@/components/shared/page-header";
import { ProductCreateForm } from "@/features/products/components/product-create-form";

export default function NewProductPage() {
  return (
    <>
      <PageHeader title="New product" description="Units, variants, barcodes and prices are saved together." />
      <ProductCreateForm />
    </>
  );
}
