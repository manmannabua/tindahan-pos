"use client";

import { PageHeader } from "@/components/shared/page-header";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { usePermission } from "@/features/auth/hooks";
import { useCompany } from "@/features/settings/api";
import { useStorefront } from "@/features/storefront/api";
import { StorefrontForm } from "@/features/storefront/components/storefront-form";
import { PERM } from "@/lib/auth/permissions";

export default function OnlineCatalogPage() {
  const storefront = useStorefront();
  const company = useCompany();
  const canManage = usePermission(PERM.COMPANY_MANAGE);
  const error = storefront.error ?? company.error;

  return (
    <>
      <PageHeader title="Online catalog" description="A public page where customers see what you sell and what's in stock." />
      <div className="max-w-3xl">
        {error ? (
          <QueryError
            error={error}
            onRetry={() => {
              void storefront.refetch();
              void company.refetch();
            }}
          />
        ) : !storefront.data || !company.data ? (
          <TableSkeleton rows={4} />
        ) : (
          <StorefrontForm
            key={`${storefront.data.slug}-${String(storefront.data.configured)}`}
            storefront={storefront.data}
            storeName={company.data.name}
            readOnly={!canManage}
          />
        )}
      </div>
    </>
  );
}
