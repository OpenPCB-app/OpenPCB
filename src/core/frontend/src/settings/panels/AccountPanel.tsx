import { CircleCheck } from "lucide-react";
import { useSession } from "./account/useSession";
import { AccountSignedIn } from "./account/AccountSignedIn";
import { AuthCard } from "./account/AuthCard";
import { CloudValueCard } from "./account/CloudValueCard";
import { AiCloudTeaser } from "./account/AiCloudTeaser";

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
        <AuthCard />
        <CloudValueCard />
      </div>

      <AiCloudTeaser />
    </div>
  );
}
