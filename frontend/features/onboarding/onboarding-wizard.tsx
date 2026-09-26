"use client";

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BoxesIcon,
  CheckCircle2Icon,
  GlobeIcon,
  MonitorSmartphoneIcon,
  PackagePlusIcon,
  ReceiptTextIcon,
  UploadIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { TextAreaField, TextField } from "@/components/shared/form-fields";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useBranches, useUpdateBranch } from "@/features/branches/api";
import { useCompany, useCompleteOnboarding, useFeatureSettings, useSaveFeatures, useUpdateCompany } from "@/features/settings/api";
import {
  type FeatureChoices,
  FeatureToggles,
  presetChoices,
  PresetPicker,
} from "@/features/settings/components/feature-toggles";
import { errorMessage } from "@/lib/api/errors";
import { isFeatureOn } from "@/lib/features";
import { emptyToNull } from "@/lib/forms";
import { cn } from "@/lib/utils";
import type { Company } from "@/types/api";
import type { FeaturesView } from "@/types/api-admin";

const STEPS = ["Business", "Store", "Features", "Next steps"] as const;

function Steps({ current }: { current: number }) {
  return (
    <ol className="mb-6 flex items-center gap-2 text-sm" aria-label="Setup progress">
      {STEPS.map((label, i) => (
        <li key={label} className="flex flex-1 items-center gap-2" aria-current={i === current ? "step" : undefined}>
          <span
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
              i < current && "border-primary bg-primary text-primary-foreground",
              i === current && "border-primary text-primary",
            )}
          >
            {i < current ? <CheckCircle2Icon className="size-4" /> : i + 1}
          </span>
          <span className={cn("hidden sm:inline", i === current ? "font-medium" : "text-muted-foreground")}>{label}</span>
          {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

function SwitchRow({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <Label htmlFor={id} className="flex flex-col items-start gap-0.5 font-normal">
        <span className="font-medium">{label}</span>
        <span className="text-sm text-muted-foreground">{hint}</span>
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function StepCard({
  title,
  description,
  children,
  onBack,
  onNext,
  nextLabel = "Continue",
  busy,
  nextDisabled,
}: {
  title: string;
  description: string;
  children: ReactNode;
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  busy?: boolean;
  nextDisabled?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          <h2>{title}</h2>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
      <CardFooter className="flex justify-between gap-2">
        {onBack ? (
          <Button variant="ghost" onClick={onBack} disabled={busy}>
            <ArrowLeftIcon /> Back
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={onNext} disabled={busy || nextDisabled}>
          {busy ? "Saving…" : nextLabel} {!busy && <ArrowRightIcon />}
        </Button>
      </CardFooter>
    </Card>
  );
}

function BusinessStep({ company, onDone }: { company: Company; onDone: () => void }) {
  const update = useUpdateCompany();
  const [v, setV] = useState({
    name: company.name,
    legal_name: company.legal_name ?? "",
    tin: company.tin ?? "",
    vat_registered: company.vat_registered,
    prices_include_tax: company.prices_include_tax,
  });
  const next = async () => {
    try {
      await update.mutateAsync({ ...v, name: v.name.trim(), legal_name: emptyToNull(v.legal_name), tin: emptyToNull(v.tin) });
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <StepCard
      title="Tell us about your business"
      description="This goes on your receipts. You can change it later in Settings → Company."
      onNext={() => void next()}
      busy={update.isPending}
      nextDisabled={v.name.trim().length < 2}
    >
      <TextField label="Business name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Registered (legal) name" description="Optional" value={v.legal_name} onChange={(e) => setV({ ...v, legal_name: e.target.value })} />
        <TextField label="TIN" description="Optional" value={v.tin} onChange={(e) => setV({ ...v, tin: e.target.value })} />
      </div>
      <SwitchRow id="vat" label="VAT-registered" hint="Receipts say VAT REG TIN; off prints NON-VAT REG TIN." checked={v.vat_registered} onChange={(on) => setV({ ...v, vat_registered: on })} />
      <SwitchRow id="incl" label="Shelf prices include VAT" hint="Usual in the Philippines: VAT is taken out of the price." checked={v.prices_include_tax} onChange={(on) => setV({ ...v, prices_include_tax: on })} />
    </StepCard>
  );
}

function StoreStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const { data: branches, isPending, error, refetch } = useBranches();
  const branch = branches?.[0];
  if (isPending) return <TableSkeleton rows={4} />;
  if (error || !branch) return <QueryError error={error ?? new Error("No branch found")} onRetry={() => void refetch()} />;
  return <StoreForm key={branch.id} branch={branch} onBack={onBack} onDone={onDone} />;
}

function StoreForm({
  branch,
  onBack,
  onDone,
}: {
  branch: { id: string; name: string; address: string | null; phone: string | null; receipt_footer?: string | null };
  onBack: () => void;
  onDone: () => void;
}) {
  const update = useUpdateBranch(branch.id);
  const [v, setV] = useState({
    name: branch.name,
    address: branch.address ?? "",
    phone: branch.phone ?? "",
    receipt_footer: branch.receipt_footer ?? "Thank you!",
  });
  const next = async () => {
    try {
      await update.mutateAsync({
        name: v.name.trim(),
        address: emptyToNull(v.address),
        phone: emptyToNull(v.phone),
        receipt_footer: emptyToNull(v.receipt_footer),
      });
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <StepCard
      title="Your store"
      description="Where you sell. More branches can be added later."
      onBack={onBack}
      onNext={() => void next()}
      busy={update.isPending}
      nextDisabled={v.name.trim().length < 2}
    >
      <TextField label="Store name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      <TextField label="Address" description="Printed on receipts" value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} />
      <TextField label="Phone" type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
      <TextAreaField label="Receipt footer" rows={2} value={v.receipt_footer} onChange={(e) => setV({ ...v, receipt_footer: e.target.value })} />
    </StepCard>
  );
}

function FeaturesStep({ view, onBack, onDone }: { view: FeaturesView; onBack: () => void; onDone: (choices: FeatureChoices) => void }) {
  const save = useSaveFeatures();
  const standard = view.presets.find((p) => p.key === "standard") ?? view.presets[0];
  const [choices, setChoices] = useState<FeatureChoices>(() => presetChoices(view.features, standard));
  const next = async () => {
    try {
      await save.mutateAsync(choices);
      onDone(choices);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <StepCard
      title="What will you use?"
      description="Pick a starting point, then switch individual features on or off. Change it any time in Settings → Features."
      onBack={onBack}
      onNext={() => void next()}
      busy={save.isPending}
    >
      <PresetPicker features={view.features} presets={view.presets} choices={choices} onChange={setChoices} />
      <FeatureToggles features={view.features} choices={choices} onChange={setChoices} />
    </StepCard>
  );
}

function NextStep({ icon: Icon, title, text, href, cta }: { icon: typeof BoxesIcon; title: string; text: string; href: string; cta: string }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border p-4">
      <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
      <Link href={href} className="shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline">
        {cta}
      </Link>
    </li>
  );
}

function DoneStep({ features, onBack, onFinish, busy }: { features: FeatureChoices; onBack: () => void; onFinish: () => void; busy: boolean }) {
  return (
    <StepCard
      title="You're set up"
      description="A few things to do next — in any order, whenever you're ready."
      onBack={onBack}
      onNext={onFinish}
      nextLabel="Go to dashboard"
      busy={busy}
    >
      <ul className="grid gap-3">
        <NextStep icon={PackagePlusIcon} title="Add your products" text="With barcodes and prices; photos are optional." href="/products/new" cta="Add product" />
        <NextStep icon={UploadIcon} title="…or import them" text="From a CSV or Excel sheet you already have." href="/products/import" cta="Import" />
        <NextStep icon={UsersIcon} title="Add your staff" text="Cashiers sign in on the terminal with a PIN." href="/users" cta="Add staff" />
        <NextStep icon={MonitorSmartphoneIcon} title="Set up a terminal" text="Any tablet or PC with Chrome; works offline after setup." href="/pos/setup" cta="Set up" />
        {isFeatureOn(features, "online_catalog") && (
          <NextStep icon={GlobeIcon} title="Publish your online catalog" text="Let customers see what's in stock." href="/online-catalog" cta="Set up" />
        )}
        {isFeatureOn(features, "bir") && (
          <NextStep icon={ReceiptTextIcon} title="Add BIR details" text="Accreditation no. (Company) and each terminal's MIN / PTU (Devices)." href="/settings/company" cta="Open" />
        )}
      </ul>
    </StepCard>
  );
}

/** First-run setup for a new business (owner only). */
export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [chosen, setChosen] = useState<FeatureChoices>({});
  const company = useCompany();
  const featureView = useFeatureSettings();
  const complete = useCompleteOnboarding();

  const finish = async () => {
    try {
      await complete.mutateAsync();
      router.replace("/dashboard");
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const error = company.error ?? featureView.error;
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome! Let&apos;s set up your store</h1>
          <p className="text-sm text-muted-foreground">About two minutes. Everything can be changed later.</p>
        </div>
        <Button variant="ghost" size="sm" disabled={complete.isPending} onClick={() => void finish()}>
          Skip for now
        </Button>
      </div>
      <Steps current={step} />
      {error ? (
        <QueryError
          error={error}
          onRetry={() => {
            void company.refetch();
            void featureView.refetch();
          }}
        />
      ) : !company.data || !featureView.data ? (
        <TableSkeleton rows={5} />
      ) : step === 0 ? (
        <BusinessStep company={company.data} onDone={() => setStep(1)} />
      ) : step === 1 ? (
        <StoreStep onBack={() => setStep(0)} onDone={() => setStep(2)} />
      ) : step === 2 ? (
        <FeaturesStep
          view={featureView.data}
          onBack={() => setStep(1)}
          onDone={(choices) => {
            setChosen(choices);
            setStep(3);
          }}
        />
      ) : (
        <DoneStep features={chosen} onBack={() => setStep(2)} onFinish={() => void finish()} busy={complete.isPending} />
      )}
    </div>
  );
}
