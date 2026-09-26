"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CopyIcon, ExternalLinkIcon } from "lucide-react";
import Link from "next/link";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { SelectField, TextAreaField, TextField } from "@/components/shared/form-fields";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useBranches } from "@/features/branches/api";
import { errorMessage } from "@/lib/api/errors";
import { applyServerErrors, emptyToNull } from "@/lib/forms";
import { isValidDecimal } from "@/lib/money";
import type { StockDisplay, Storefront } from "@/types/api-admin";

import { storefrontUrl, useSaveStorefront } from "../api";
import { StoreQrCode } from "./store-qr-code";

const STOCK_OPTIONS: { value: StockDisplay; label: string }[] = [
  { value: "AVAILABILITY", label: "In stock / Low stock / Out of stock" },
  { value: "QUANTITY", label: "Exact quantity" },
  { value: "HIDDEN", label: "Don't show stock" },
];

const schema = z
  .object({
    enabled: z.boolean(),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(3, "At least 3 characters")
      .max(48)
      .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Use letters, numbers and dashes (not at the start or end)"),
    branch_ids: z.array(z.string()),
    stock_display: z.enum(["AVAILABILITY", "QUANTITY", "HIDDEN"]),
    low_stock_threshold: z.string().trim().refine((v) => isValidDecimal(v) && !v.startsWith("-"), "Enter a quantity"),
    show_prices: z.boolean(),
    allow_indexing: z.boolean(),
    about: z.string().max(1000),
    phone: z.string().max(50),
    messenger_url: z
      .string()
      .trim()
      .max(300)
      .refine((v) => v === "" || /^https:\/\/\S+$/.test(v), "Must be an https:// link"),
    hours: z.string().max(200),
  })
  .refine((v) => !v.enabled || v.branch_ids.length > 0, {
    path: ["branch_ids"],
    message: "Choose at least one branch to show online",
  });

type Values = z.infer<typeof schema>;

function toValues(s: Storefront): Values {
  return {
    enabled: s.enabled,
    slug: s.slug,
    branch_ids: s.branch_ids,
    stock_display: s.stock_display,
    low_stock_threshold: String(Number(s.low_stock_threshold)),
    show_prices: s.show_prices,
    allow_indexing: s.allow_indexing,
    about: s.about ?? "",
    phone: s.phone ?? "",
    messenger_url: s.messenger_url ?? "",
    hours: s.hours ?? "",
  };
}

function SwitchRow({ id, label, description, checked, onChange, disabled }: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </Field>
  );
}

export function StorefrontForm({ storefront, storeName, readOnly }: { storefront: Storefront; storeName: string; readOnly: boolean }) {
  const save = useSaveStorefront();
  const { data: branches } = useBranches();
  const {
    register,
    control,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(storefront) });
  const stockDisplay = useWatch({ control, name: "stock_display" });
  const slug = useWatch({ control, name: "slug" });
  const live = storefront.configured && storefront.enabled;
  const url = storefrontUrl(storefront.slug);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const saved = await save.mutateAsync({
        ...values,
        about: emptyToNull(values.about),
        phone: emptyToNull(values.phone),
        messenger_url: emptyToNull(values.messenger_url),
        hours: emptyToNull(values.hours),
      });
      reset(toValues(saved));
      toast.success(saved.enabled ? "Online catalog saved and published" : "Online catalog saved");
    } catch (error) {
      if (!applyServerErrors(error, setError, ["slug", "branch_ids", "messenger_url", "low_stock_threshold"])) {
        toast.error(errorMessage(error));
      }
    }
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy the link");
    }
  };

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Your public catalog
            {live ? <Badge>Live</Badge> : <Badge variant="secondary">Off</Badge>}
          </CardTitle>
          <CardDescription>
            Customers can browse and search the products you choose to show, with prices and stock. There is no ordering or
            checkout. {storefront.published_products} product{storefront.published_products === 1 ? " is" : "s are"} shown online —
            choose which on the <Link href="/products" className="underline underline-offset-2">Products</Link> page.
          </CardDescription>
        </CardHeader>
        {live && (
          <CardContent className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <code className="bg-muted rounded px-2 py-1 text-sm break-all">{url}</code>
              <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
                <CopyIcon /> Copy link
              </Button>
              <a href={`/s/${storefront.slug}`} target="_blank" rel="noopener" className={buttonVariants({ size: "sm", variant: "outline" })}>
                <ExternalLinkIcon /> Open
              </a>
            </div>
            <StoreQrCode url={url} storeName={storeName} />
          </CardContent>
        )}
      </Card>

      <form onSubmit={onSubmit} noValidate>
        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
            <CardDescription>Stock shown online is as of each branch&apos;s last terminal sync.</CardDescription>
          </CardHeader>
          <CardContent>
            <fieldset disabled={readOnly} className="grid gap-5">
              <Controller
                control={control}
                name="enabled"
                render={({ field }) => (
                  <SwitchRow
                    id="storefront-enabled"
                    label="Publish online catalog"
                    description="When off, the link shows “not found”."
                    checked={field.value}
                    onChange={field.onChange}
                    disabled={readOnly}
                  />
                )}
              />
              <TextField
                label="Link name"
                description={`Your catalog address: ${typeof window === "undefined" ? "" : window.location.origin}/s/${slug || "…"}`}
                error={errors.slug?.message}
                autoCapitalize="none"
                spellCheck={false}
                {...register("slug")}
              />
              <Controller
                control={control}
                name="branch_ids"
                render={({ field }) => (
                  <Field data-invalid={errors.branch_ids ? true : undefined}>
                    <FieldLabel>Branches shown online</FieldLabel>
                    <FieldDescription>Customers pick a branch to see its stock. The first one ticked is shown first.</FieldDescription>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {(branches ?? []).map((b) => {
                        const checked = field.value.includes(b.id);
                        return (
                          <div key={b.id} className="flex items-center gap-2">
                            <Checkbox
                              id={`branch-${b.id}`}
                              checked={checked}
                              disabled={readOnly}
                              onCheckedChange={(on) =>
                                field.onChange(on ? [...field.value, b.id] : field.value.filter((id) => id !== b.id))
                              }
                            />
                            <Label htmlFor={`branch-${b.id}`} className="font-normal">
                              {b.name}
                              {checked && field.value[0] === b.id && field.value.length > 1 && (
                                <span className="text-muted-foreground ml-1 text-xs">(default)</span>
                              )}
                            </Label>
                          </div>
                        );
                      })}
                    </div>
                    <FieldError>{errors.branch_ids?.message}</FieldError>
                  </Field>
                )}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Controller
                  control={control}
                  name="stock_display"
                  render={({ field }) => (
                    <SelectField
                      label="Show stock as"
                      description="Exact quantities tell competitors your stock levels."
                      value={field.value}
                      onChange={field.onChange}
                      options={STOCK_OPTIONS}
                      disabled={readOnly}
                    />
                  )}
                />
                {stockDisplay === "AVAILABILITY" && (
                  <TextField
                    label="“Low stock” at or below"
                    inputMode="decimal"
                    error={errors.low_stock_threshold?.message}
                    {...register("low_stock_threshold")}
                  />
                )}
              </div>
              <Controller
                control={control}
                name="show_prices"
                render={({ field }) => (
                  <SwitchRow
                    id="storefront-prices"
                    label="Show prices"
                    description="Regular retail price (a branch's own price when it has one)."
                    checked={field.value}
                    onChange={field.onChange}
                    disabled={readOnly}
                  />
                )}
              />
              <Controller
                control={control}
                name="allow_indexing"
                render={({ field }) => (
                  <SwitchRow
                    id="storefront-indexing"
                    label="Let Google and other search engines list it"
                    description="Off: only people with the link or QR code find it."
                    checked={field.value}
                    onChange={field.onChange}
                    disabled={readOnly}
                  />
                )}
              />
              <TextAreaField label="About the store" rows={2} error={errors.about?.message} {...register("about")} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Phone" type="tel" error={errors.phone?.message} {...register("phone")} />
                <TextField label="Opening hours" placeholder="Mon–Sat 7am–9pm" error={errors.hours?.message} {...register("hours")} />
              </div>
              <TextField
                label="Messenger / Facebook link"
                placeholder="https://m.me/yourpage"
                error={errors.messenger_url?.message}
                {...register("messenger_url")}
              />
            </fieldset>
          </CardContent>
          {!readOnly && (
            <CardFooter className="justify-end">
              <Button type="submit" disabled={isSubmitting || (!isDirty && storefront.configured)}>
                {isSubmitting ? "Saving…" : "Save"}
              </Button>
            </CardFooter>
          )}
        </Card>
      </form>
    </div>
  );
}
