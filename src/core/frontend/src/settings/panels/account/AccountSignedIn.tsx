import { CircleCheck } from "lucide-react";
import { useAuth } from "@/cloud/AuthProvider";
import { useCloudPrefs } from "@/cloud/cloud-prefs";
import { cn } from "@/lib/utils";
import type { AccountSession } from "./useSession";

/**
 * Signed-in account view: identity, plan, sign-out, and the project-sync
 * master switch. Password management (change / reset) lives on the Cloud
 * website.
 */
export function AccountSignedIn({ session }: { session: AccountSession }) {
  const { signOut } = useAuth();
  const projectSyncEnabled = useCloudPrefs((s) => s.projectSyncEnabled);
  const setProjectSyncEnabled = useCloudPrefs((s) => s.setProjectSyncEnabled);

  const planLabel = session.tier === "pro" ? "Pro" : "Free";

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
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              Sync projects to cloud
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              When on, your designs sync to your OpenPCB Cloud workspace. Turn
              off to keep all project data on this machine.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={projectSyncEnabled}
            aria-label="Sync projects to cloud"
            onClick={() => setProjectSyncEnabled(!projectSyncEnabled)}
            className={cn(
              "relative mt-0.5 h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors",
              projectSyncEnabled
                ? "bg-violet-600"
                : "bg-slate-300 dark:bg-slate-700",
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                projectSyncEnabled ? "translate-x-[22px]" : "translate-x-0.5",
              )}
            />
          </button>
        </div>
      </section>
    </div>
  );
}
