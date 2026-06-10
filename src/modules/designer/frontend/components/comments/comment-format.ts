/** Compact relative time ("now", "5m", "3h", "2d", "1w", "4mo", "1y"). */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return "now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.round(days / 7);
  if (weeks < 5) return `${weeks}w`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.round(days / 365)}y`;
}

/** Local-part of an email or the raw name, for display ("a@b.com" → "a"). */
export function displayNameFrom(value: string | null | undefined): string {
  if (!value) return "Local";
  return value.includes("@") ? (value.split("@")[0] ?? value) : value;
}

/** Up to two-letter initials for an avatar fallback. */
export function initialsFrom(value: string | null | undefined): string {
  if (!value) return "·";
  const base = value.includes("@") ? (value.split("@")[0] ?? value) : value;
  const parts = base.split(/[.\s_-]+/).filter(Boolean);
  if (parts.length === 0) return base.slice(0, 2).toUpperCase();
  if (parts.length === 1) return (parts[0] ?? "").slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}
