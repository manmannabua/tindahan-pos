"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircleIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { TextField } from "@/components/shared/form-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldSeparator } from "@/components/ui/field";
import { errorMessage } from "@/lib/api/errors";
import { applyServerErrors } from "@/lib/forms";

import { signup } from "../api";

// Mirrors backend SignupRequest constraints (app/modules/companies/schemas.py).
const schema = z
  .object({
    company_name: z.string().trim().min(2, "At least 2 characters").max(200),
    company_code: z
      .string()
      .trim()
      .regex(/^[A-Z0-9][A-Z0-9_-]{1,31}$/, "2–32 uppercase letters, digits, - or _"),
    owner_full_name: z.string().trim().min(2, "At least 2 characters").max(200),
    owner_email: z.email("Enter a valid email"),
    owner_username: z
      .string()
      .trim()
      .regex(/^[a-z0-9][a-z0-9._-]{1,63}$/, "2–64 lowercase letters, digits, . _ or -"),
    owner_password: z.string().min(10, "At least 10 characters").max(128),
    confirm_password: z.string(),
  })
  .refine((v) => v.owner_password === v.confirm_password, {
    path: ["confirm_password"],
    message: "Passwords don't match",
  });

type SignupValues = z.infer<typeof schema>;

const FIELDS = [
  "company_name",
  "company_code",
  "owner_full_name",
  "owner_email",
  "owner_username",
  "owner_password",
] as const;

export function SignupForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<SignupValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      company_name: "",
      company_code: "",
      owner_full_name: "",
      owner_email: "",
      owner_username: "",
      owner_password: "",
      confirm_password: "",
    },
  });

  const onSubmit = handleSubmit(async ({ confirm_password, ...values }) => {
    setFormError(null);
    try {
      await signup(values);
      router.replace("/onboarding");
    } catch (error) {
      if (!applyServerErrors(error, setError, FIELDS)) setFormError(errorMessage(error));
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      {formError && (
        <Alert variant="destructive">
          <AlertCircleIcon />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      <TextField label="Business name" autoFocus error={errors.company_name?.message} {...register("company_name")} />
      <TextField
        label="Company code"
        description="Short identifier, e.g. ACME. Used on receipts and cannot be changed later."
        className="uppercase"
        error={errors.company_code?.message}
        {...register("company_code", { setValueAs: (v: string) => v.toUpperCase() })}
      />
      <FieldSeparator>Owner account</FieldSeparator>
      <TextField label="Full name" autoComplete="name" error={errors.owner_full_name?.message} {...register("owner_full_name")} />
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          error={errors.owner_email?.message}
          {...register("owner_email")}
        />
        <TextField
          label="Username"
          autoComplete="username"
          error={errors.owner_username?.message}
          {...register("owner_username", { setValueAs: (v: string) => v.toLowerCase() })}
        />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          error={errors.owner_password?.message}
          {...register("owner_password")}
        />
        <TextField
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          error={errors.confirm_password?.message}
          {...register("confirm_password")}
        />
      </div>
      <Button type="submit" size="lg" className="h-11 w-full" disabled={isSubmitting}>
        {isSubmitting ? "Creating your business…" : "Create business"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </form>
  );
}
