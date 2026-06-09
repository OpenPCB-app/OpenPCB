import { useState } from "react";
import { CircleCheck } from "lucide-react";
import { useAuth } from "@/cloud/AuthProvider";
import type { AccountSession } from "./useSession";

/**
 * Signed-in account view: identity, plan, sign-out, and password change.
 * The change-password form also completes the password-reset flow — a recovery
 * link signs the user in (via the openpcb://auth-callback deep-link), after
 * which they set a new password here.
 */
export function AccountSignedIn({ session }: { session: AccountSession }) {
  const { signOut, updatePassword } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const planLabel = session.tier === "pro" ? "Pro" : "Free";

  const handleChangePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setDone(false);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      await updatePassword(password);
      setPassword("");
      setConfirm("");
      setDone(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update password.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100">
          Account
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Signed in to OpenPCB Cloud.
        </p>
      </header>

      <div className="rounded-lg border border-slate-200 bg-white px-4 py-[14px] dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm text-slate-900 dark:text-slate-100">
              <span className="text-slate-500 dark:text-slate-400">
                Signed in as{" "}
              </span>
              <span className="font-medium">{session.email}</span>
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
              <CircleCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
              Plan: <span className="font-medium">{planLabel}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="h-9 shrink-0 cursor-pointer rounded-md border border-slate-300 px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Sign out
          </button>
        </div>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white px-4 py-[14px] dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">
          Change password
        </h3>
        <form onSubmit={handleChangePassword} className="space-y-3" noValidate>
          <input
            type="password"
            autoComplete="new-password"
            placeholder="New password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          <input
            type="password"
            autoComplete="new-password"
            placeholder="Confirm new password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
          />
          <button
            type="submit"
            disabled={submitting}
            className="h-9 w-full cursor-pointer rounded-md bg-violet-600 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Updating…" : "Update password"}
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
        {done ? (
          <p
            role="status"
            className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
          >
            Password updated.
          </p>
        ) : null}
      </section>
    </div>
  );
}
