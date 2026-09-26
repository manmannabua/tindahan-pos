import { z } from "zod";

// Mirrors backend constraints (app/modules/users/schemas.py, companies/schemas.py).
export const pinSchema = z.string().regex(/^\d{4,8}$/, "4–8 digits");
export const passwordSchema = z.string().min(10, "At least 10 characters").max(128);
export const usernameSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9._-]{1,63}$/, "2–64 lowercase letters, digits, . _ or -");

export const roleAssignmentsSchema = z
  .array(z.object({ role_id: z.string(), branch_id: z.string().nullable() }))
  .min(1, "Assign at least one role")
  .refine((rows) => rows.every((r) => r.role_id), "Choose a role for every row");
