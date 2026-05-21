import { useState } from "react";
import { useAuth } from "@/cloud/AuthProvider";

export function AccountPanel() {
  const { enabled, user, tier, loading, signIn, signOut } = useAuth();

  if (!enabled) return null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-violet-600" />
      </div>
    );
  }

  if (user) {
    return (
      <SignedInView email={user.email ?? ""} tier={tier} onSignOut={signOut} />
    );
  }

  return <SignInForm onSignIn={signIn} />;
}

function SignedInView({
  email,
  tier,
  onSignOut,
}: {
  email: string;
  tier: "pro" | null;
  onSignOut: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);

  const handleSignOut = () => {
    setError(null);
    onSignOut().catch((err: unknown) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
  };

  return (
    <div className="space-y-6 pb-24 text-slate-900 dark:text-slate-100">
      <div>
        <h2 className="text-lg font-semibold">Account</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Manage your OpenPCB cloud account.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
              {email}
            </p>
            <div className="mt-1">
              {tier === "pro" ? (
                <span className="inline-block rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                  Pro
                </span>
              ) : (
                <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  Free
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="shrink-0 rounded-xl border border-slate-300 px-4 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
          >
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
}

function SignInForm({
  onSignIn,
}: {
  onSignIn: (email: string, password: string) => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    onSignIn(email, password)
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setSubmitting(false));
  };

  return (
    <div className="space-y-6 pb-24 text-slate-900 dark:text-slate-100">
      <div>
        <h2 className="text-lg font-semibold">Account</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Sign in to your OpenPCB cloud account.
        </p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error ? (
            <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
              {error}
            </div>
          ) : null}

          <label className="block space-y-2 text-sm">
            <span className="text-slate-500">Email</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>

          <label className="block space-y-2 text-sm">
            <span className="text-slate-500">Password</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950"
            />
          </label>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
