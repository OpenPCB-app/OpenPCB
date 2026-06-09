import { CircleCheck } from "lucide-react";
import { useAuth } from "@/cloud/AuthProvider";
import { useSession } from "./account/useSession";
import { AccountSignedIn } from "./account/AccountSignedIn";
import { CloudValueCard } from "./account/CloudValueCard";
import { AiCloudTeaser } from "./account/AiCloudTeaser";

function SignInCard() {
  const { enabled, beginCloudLogin, loginError } = useAuth();

  return (
    <section className="rounded-lg border border-slate-200 bg-white px-4 py-[14px] dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-1 text-sm font-medium text-slate-900 dark:text-slate-100">
        Sign in
      </h3>
      {!enabled ? (
        <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
          Cloud accounts aren't available in this build. The desktop app is
          fully usable offline.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
            Opens your browser to sign in, then returns to the app.
          </p>
          <button
            type="button"
            onClick={() => void beginCloudLogin()}
            className="h-9 w-full cursor-pointer rounded-md bg-violet-600 text-sm font-medium text-white transition-colors hover:bg-violet-500"
          >
            Sign in to OpenPCB Cloud
          </button>
          {loginError ? (
            <p
              role="alert"
              className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-500/10 dark:text-red-300"
            >
              {loginError}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

export function AccountPanel() {
  const session = useSession();

  if (session) {
    return <AccountSignedIn session={session} />;
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-medium text-slate-900 dark:text-slate-100">
          Account
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Sign in for OpenPCB Cloud. The desktop app stays free and works
          offline without an account.
        </p>
      </header>

      <div className="flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
        <CircleCheck className="h-4 w-4 shrink-0" strokeWidth={1.8} />
        <span>
          Current plan: <span className="font-medium">Free</span> · works
          offline
        </span>
      </div>

      <div className="grid gap-[14px] [grid-template-columns:repeat(auto-fit,minmax(205px,1fr))]">
        <SignInCard />
        <CloudValueCard />
      </div>

      <AiCloudTeaser />
    </div>
  );
}
