"use client";

import { type ComponentProps, useId } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface FieldChrome {
  label: string;
  error?: string;
  description?: string;
}

/** Labeled input for use with `{...register("name")}`. */
export function TextField({ label, error, description, id, ...props }: FieldChrome & ComponentProps<"input">) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <Input id={inputId} aria-invalid={error ? true : undefined} {...props} />
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError>{error}</FieldError>
    </Field>
  );
}

export function TextAreaField({ label, error, description, id, ...props }: FieldChrome & ComponentProps<"textarea">) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <Textarea id={inputId} aria-invalid={error ? true : undefined} {...props} />
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError>{error}</FieldError>
    </Field>
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

interface SimpleSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  id?: string;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** A single-value select over a flat option list. */
export function SimpleSelect({
  value,
  onChange,
  options,
  placeholder,
  id,
  disabled,
  invalid,
  className,
  "aria-label": ariaLabel,
}: SimpleSelectProps) {
  const items = Object.fromEntries(options.map((o) => [o.value, o.label]));
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (typeof next === "string") onChange(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger id={id} className={className ?? "w-full"} aria-invalid={invalid || undefined} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SelectField({
  label,
  error,
  description,
  ...props
}: FieldChrome & Omit<SimpleSelectProps, "invalid" | "id">) {
  const id = useId();
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <SimpleSelect id={id} invalid={Boolean(error)} {...props} />
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError>{error}</FieldError>
    </Field>
  );
}
