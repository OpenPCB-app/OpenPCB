import { useState } from "react";
import { Github } from "lucide-react";
import { cn } from "@/lib/utils";
import { CLOUD_AUTH_ENABLED, COMING_SOON_NOTICE } from "./config";
import { emailHint } from "./auth-schema";

export function AuthCard() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  const [showNotice, setShowNotice] = useState(false);

  const emailError = emailTouched ? emailHint(email) : null;

  // While the flag is off every action is inert and surfaces the notice.
  const inert = (event?: { preventDefault: () => void }) => {
    event?.preventDefault();
    if (!CLOUD_AUTH_ENABLED) {
      setShowNotice(true);
      return true;
    }
    return false;
  };

  const handleSubmit = (event: React.FormEvent) => {
    if (inert(event)) return;
    // TODO(cloud-auth): call auth client (sign in).
  };

  const handleGitHub = () => {
    if (inert()) return;
    // TODO(cloud-auth): start GitHub OAuth flow.
  };

  const handleForgot = () => {
    if (inert()) return;
    // TODO(cloud-auth): open password reset flow.
  };

  return (
    <section className="rounded-lg border border-slate-200 bg-white px-4 py-[14px] dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">
        Sign in
      </h3>

      <button
        type="button"
        onClick={handleGitHub}
        className="flex h-9 w-full cursor-pointer items-center justify-center gap-2 rounded-md border border-slate-300 bg-white text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <Github className="h-4 w-4" strokeWidth={1.8} />
        Continue with GitHub
      </button>

      <div className="my-3 flex items-center gap-3 text-xs text-slate-400 dark:text-slate-500">
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
        or
        <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
      </div>

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
              className="cursor-pointer text-xs font-medium text-violet-600 hover:text-violet-500 dark:text-violet-400"
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
          className="h-9 w-full cursor-pointer rounded-md bg-violet-600 text-sm font-medium text-white transition-colors hover:bg-violet-500"
        >
          Sign in
        </button>
      </form>

      {showNotice ? (
        <p
          role="status"
          className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
        >
          {COMING_SOON_NOTICE}
        </p>
      ) : null}
    </section>
  );
}
