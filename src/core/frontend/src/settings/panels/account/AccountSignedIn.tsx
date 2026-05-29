import type { AccountSession } from "./useSession";

/**
 * Placeholder for the signed-in account view. Intentionally minimal —
 * real account management (plan, devices, sign out) lands in Phase 2.
 * // TODO(cloud-auth)
 */
export function AccountSignedIn({ session }: { session: AccountSession }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-[14px] text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
      Signed in as <span className="font-medium">{session.email}</span>.
    </div>
  );
}
