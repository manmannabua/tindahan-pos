"use client";

import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shared/page-header";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Button } from "@/components/ui/button";
import { usePermission } from "@/features/auth/hooks";
import { useFeatureSettings, useSaveFeatures } from "@/features/settings/api";
import { type FeatureChoices, FeatureToggles, PresetPicker } from "@/features/settings/components/feature-toggles";
import { errorMessage } from "@/lib/api/errors";
import { PERM } from "@/lib/auth/permissions";
import type { FeaturesView } from "@/types/api-admin";

function stateOf(view: FeaturesView): FeatureChoices {
  return Object.fromEntries(view.features.map((f) => [f.key, f.enabled]));
}

export default function FeatureSettingsPage() {
  const { data, isPending, error, refetch } = useFeatureSettings();
  const canManage = usePermission(PERM.COMPANY_MANAGE);

  return (
    <>
      <PageHeader
        title="Features"
        description="Turn on only what your business uses. Switched-off features disappear from the back office and the terminals."
      />
      <div className="max-w-3xl">
        {isPending ? (
          <TableSkeleton rows={6} />
        ) : error ? (
          <QueryError error={error} onRetry={() => void refetch()} />
        ) : (
          <FeatureForm key={JSON.stringify(stateOf(data))} view={data} readOnly={!canManage} />
        )}
      </div>
    </>
  );
}

function FeatureForm({ view, readOnly }: { view: FeaturesView; readOnly: boolean }) {
  const save = useSaveFeatures();
  const saved = stateOf(view);
  const [choices, setChoices] = useState<FeatureChoices>(saved);
  const dirty = view.features.some((f) => Boolean(choices[f.key]) !== f.enabled);

  const submit = async () => {
    try {
      await save.mutateAsync(choices);
      toast.success("Features saved. Terminals pick up the change on their next sync.");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="grid gap-6">
      <section aria-label="Presets" className="grid gap-2">
        <h2 className="text-sm font-medium">Quick setup</h2>
        <PresetPicker features={view.features} presets={view.presets} choices={choices} onChange={setChoices} disabled={readOnly} />
      </section>
      <FeatureToggles features={view.features} choices={choices} onChange={setChoices} disabled={readOnly} />
      <p className="text-sm text-muted-foreground">
        Turning a feature off never deletes data: switch it back on and everything is still there. Sales rung up offline
        with a feature that has since been switched off are still accepted.
      </p>
      {!readOnly && (
        <div className="sticky bottom-0 flex justify-end gap-2 border-t bg-background/95 py-3 backdrop-blur">
          <Button variant="ghost" disabled={!dirty || save.isPending} onClick={() => setChoices(saved)}>
            Reset
          </Button>
          <Button disabled={!dirty || save.isPending} onClick={() => void submit()}>
            {save.isPending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      )}
    </div>
  );
}
