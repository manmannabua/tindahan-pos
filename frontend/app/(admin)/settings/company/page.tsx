"use client";

import { PageHeader } from "@/components/shared/page-header";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { usePermission } from "@/features/auth/hooks";
import { useCompany } from "@/features/settings/api";
import { CompanyForm } from "@/features/settings/components/company-form";
import { PERM } from "@/lib/auth/permissions";

export default function CompanySettingsPage() {
  const { data: company, isPending, error, refetch } = useCompany();
  const canManage = usePermission(PERM.COMPANY_MANAGE);

  return (
    <>
      <PageHeader title="Company settings" description="Business identity, time zone and tax display." />
      <div className="max-w-2xl">
        {isPending ? (
          <TableSkeleton rows={3} />
        ) : error ? (
          <QueryError error={error} onRetry={() => void refetch()} />
        ) : (
          <CompanyForm key={company.id} company={company} readOnly={!canManage} />
        )}
      </div>
    </>
  );
}
