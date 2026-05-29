import { z } from "zod";

export const emailSchema = z.email();
export const passwordSchema = z.string().min(1, "Password is required.");

/** Inline hint for the email field. Returns null when empty (don't nag) or valid. */
export function emailHint(value: string): string | null {
  if (value.trim() === "") return null;
  return emailSchema.safeParse(value).success
    ? null
    : "Enter a valid email address.";
}

/** Inline hint for the password field. Returns null when empty or valid. */
export function passwordHint(value: string): string | null {
  if (value === "") return null;
  const result = passwordSchema.safeParse(value);
  return result.success ? null : (result.error.issues[0]?.message ?? null);
}
