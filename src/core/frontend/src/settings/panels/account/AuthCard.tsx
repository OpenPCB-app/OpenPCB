import { useState } from "react";
import { useAuth } from "@/cloud/AuthProvider";
import { getSupabase } from "@/cloud/supabase";
import { cn } from "@/lib/utils";
import { CLOUD_AUTH_ENABLED, COMING_SOON_NOTICE } from "./config";
import { emailHint, emailSchema } from "./auth-schema";

export function AuthCard() {
  const { enabled: cloudConfigured, signIn } = useAuth();
  const enabled = CLOUD_AUTH_ENABLED && cloudConfigured;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const emailError = emailTouched ? emailHint(email) : null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!enabled) {
      setNotice(COMING_SOON_NOTICE);
      return;
    }
    if (submitting) return;
    setError(null);
    setNotice(null);
    if (!emailSchema.safeParse(email).success) {
      setEmailTouched(true);
      return;
    }
    if (password.length === 0) {
      setError("Password is required.");
      return;
    }
    setSubmitting(true);
    try {
      // On success AuthProvider's onAuthStateChange updates the session and the
      // Account panel swaps to the signed-in view.
      await signIn(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgot = async () => {
    if (!enabled) {
      setNotice(COMING_SOON_NOTICE);
      return;
    }
    setError(null);
    setNotice(null);
    if (!emailSchema.safeParse(email).success) {
      setEmailTouched(true);
      setError("Enter your email above, then choose Forgot.");
      return;
    }
    const sb = getSupabase();
    if (!sb) return;
    setSubmitting(true);
    try {
      // Recovery link returns to the app via the openpcb://auth-callback
      // deep-link, which exchanges the code for a session; the user then sets a
      // new password from the signed-in account view.
      const { error: resetErr } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: "openpcb://auth-callback",
      });
      if (resetErr) throw resetErr;
      setNotice("Password reset email sent. Check your inbox.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not send reset email.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white px-4 py-[14px] dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">
        Sign in
      </h3>

      <form onSubmit={handleSubmit} className="space-y-3" noValidate>
        <div className="space-y-1">
          <label
            htmlFor="account-email"
            className="block text-sm text-slate-600 dark:text-slate-300"
          >
            Email
          </label>
          <input
            id="account-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onBlur={() => setEmailTouched(true)}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? "account-email-error" : undefined}
            className={cn(
              "h-9 w-full rounded-md border bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500",
              emailError
                ? "border-red-400 focus:border-red-500 focus:ring-red-500 dark:border-red-500/60"
                : "border-slate-300 focus:border-violet-500 focus:ring-violet-500 dark:border-slate-700",
            )}
          />
          {emailError ? (
            <p
              id="account-email-error"
              className="text-xs text-red-600 dark:text-red-400"
            >
              {emailError}
            </p>
          ) : null}
        </div>

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label
              htmlFor="account-password"
              className="block text-sm text-slate-600 dark:text-slate-300"
            >
              Password
            </label>
            <button
              type="button"
              onClick={handleForgot}
              disabled={submitting}
              className="cursor-pointer text-xs font-medium text-violet-600 hover:text-violet-500 disabled:cursor-not-allowed disabled:opacity-60 dark:text-violet-400"
            >
              Forgot?
            </button>
          </div>
          <input
            id="account-password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="h-9 w-full cursor-pointer rounded-md bg-violet-600 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </form>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      {notice ? (
        <p
          role="status"
          className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
        >
          {notice}
        </p>
      ) : null}
    </section>
  );
}
