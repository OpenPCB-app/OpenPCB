import { selectNetIdentityUnreadCount, useNetIdentityActivityStore } from "./net-identity-activity-store";

export function NetIdentityActivityBadge({ scope, designId }: { scope?: string; designId?: string | null }) {
  const unread = useNetIdentityActivityStore(selectNetIdentityUnreadCount(scope ?? "", designId ?? ""));
  if (!scope || !designId || unread === 0) return null;
  return <span role="status" aria-label={`${unread} unread net changes`}
    className="rounded-control bg-status-warning-soft px-1 font-mono text-2xs text-status-warning">
    Nets {unread}
  </span>;
}
