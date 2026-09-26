"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMemo } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { SelectField, TextField } from "@/components/shared/form-fields";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/api/errors";
import { applyServerErrors, emptyToNull } from "@/lib/forms";
import type { Company } from "@/types/api";

import { useUpdateCompany } from "../api";

const schema = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(200),
  legal_name: z.string().max(200),
  tin: z.string().max(32),
  timezone: z.string().min(1),
  prices_include_tax: z.boolean(),
  vat_registered: z.boolean(),
  bir_accreditation_no: z.string().max(64),
});

type CompanyValues = z.infer<typeof schema>;

export function CompanyForm({ company, readOnly }: { company: Company; readOnly: boolean }) {
  const update = useUpdateCompany();
  const timezones = useMemo(() => Intl.supportedValuesOf("timeZone").map((tz) => ({ value: tz, label: tz })), []);
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<CompanyValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: company.name,
      legal_name: company.legal_name ?? "",
      tin: company.tin ?? "",
      timezone: company.timezone,
      prices_include_tax: company.prices_include_tax,
      vat_registered: company.vat_registered,
      bir_accreditation_no: company.bir_accreditation_no ?? "",
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    try {
      await update.mutateAsync({
        ...values,
        legal_name: emptyToNull(values.legal_name),
        tin: emptyToNull(values.tin),
        bir_accreditation_no: emptyToNull(values.bir_accreditation_no),
      });
      reset(values);
      toast.success("Company settings saved");
    } catch (error) {
      if (!applyServerErrors(error, setError, ["name", "legal_name", "tin", "timezone", "bir_accreditation_no"])) toast.error(errorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <Card>
        <CardHeader>
          <CardTitle>
            {company.code} · {company.currency}
          </CardTitle>
          <CardDescription>The company code and currency are fixed once created.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <fieldset disabled={readOnly} className="grid gap-4">
            <TextField label="Business name" error={errors.name?.message} {...register("name")} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label="Registered (legal) name" error={errors.legal_name?.message} {...register("legal_name")} />
              <TextField label="TIN" error={errors.tin?.message} {...register("tin")} />
            </div>
            <Controller
              control={control}
              name="timezone"
              render={({ field }) => (
                <SelectField
                  label="Time zone"
                  description="Used for business days in reports and receipts."
                  value={field.value}
                  onChange={field.onChange}
                  options={timezones}
                  disabled={readOnly}
                />
              )}
            />
            <Controller
              control={control}
              name="prices_include_tax"
              render={({ field }) => (
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="prices-include-tax">Prices include VAT</FieldLabel>
                    <FieldDescription>
                      On (typical in the Philippines): shelf prices are VAT-inclusive and VAT is extracted from them.
                    </FieldDescription>
                  </FieldContent>
                  <Switch id="prices-include-tax" checked={field.value} onCheckedChange={field.onChange} disabled={readOnly} />
                </Field>
              )}
            />
            <Controller
              control={control}
              name="vat_registered"
              render={({ field }) => (
                <Field orientation="horizontal">
                  <FieldContent>
                    <FieldLabel htmlFor="vat-registered">VAT-registered</FieldLabel>
                    <FieldDescription>
                      Receipts print &quot;VAT REG TIN&quot;; off prints &quot;NON-VAT REG TIN&quot;.
                    </FieldDescription>
                  </FieldContent>
                  <Switch id="vat-registered" checked={field.value} onCheckedChange={field.onChange} disabled={readOnly} />
                </Field>
              )}
            />
            <TextField
              label="BIR accreditation no."
              description="The POS software accreditation number printed on receipts."
              error={errors.bir_accreditation_no?.message}
              {...register("bir_accreditation_no")}
            />
          </fieldset>
        </CardContent>
        {!readOnly && (
          <CardFooter className="justify-end">
            <Button type="submit" disabled={isSubmitting || !isDirty}>
              {isSubmitting ? "Saving…" : "Save changes"}
            </Button>
          </CardFooter>
        )}
      </Card>
    </form>
  );
}
