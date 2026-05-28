/** Shared chat formatting helpers (dedupes copies in Space + DesignerChatDock). */

export function relativeTime(iso: string | null): string {
  if (!iso) return "new";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Human label for a message-stream date divider (TODAY / YESTERDAY / date). */
export function dateDividerLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayMs = 86_400_000;
  const diffDays = Math.round((startOf(today) - startOf(d)) / dayMs);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: today.getFullYear() === d.getFullYear() ? undefined : "numeric",
  });
}

/** Stable day key (local date) for grouping messages under a divider. */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** KB budget per context-size preference (from @openpcb/ai-core limits). */
export function contextBudgetKb(
  pref: "small" | "medium" | "large" | undefined,
): number {
  if (pref === "small") return 16;
  if (pref === "large") return 128;
  return 64;
}

/** Tool duration in ms from event timestamps, or null if not finished. */
export function toolDurationMs(
  createdAt: string,
  updatedAt: string | null | undefined,
): number | null {
  if (!updatedAt) return null;
  const ms = new Date(updatedAt).getTime() - new Date(createdAt).getTime();
  return ms >= 0 && Number.isFinite(ms) ? ms : null;
}
