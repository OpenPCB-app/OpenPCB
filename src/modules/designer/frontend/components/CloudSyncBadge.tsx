import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useAuth } from "@/cloud/AuthProvider";
import { useCloudPrefs } from "@/cloud/cloud-prefs";

interface CloudLink {
  cloudDesignId: string;
  lastSyncedRevision: number;
  failedAttempts: number;
  lastError: string | null;
}

interface CloudSyncBadgeProps {
  designId: string | null;
  api: {
    linkDesignToCloud(designId: string): Promise<{
      link: { cloudDesignId: string; workspaceId: string; userId: string };
    }>;
    getCloudLink(designId: string): Promise<{
      link: CloudLink | null;
    }>;
    unlinkDesignFromCloud(designId: string): Promise<{ ok: boolean }>;
  };
  onNotify: (
    message: string,
    variant?: "info" | "success" | "warning" | "error",
  ) => void;
}

/**
 * Cloud-sync status for the open design. Under automatic sync, designs link
 * themselves when signed in + project sync is on (no manual button) — this badge
 * is purely informational. The master switch lives in Settings → Account.
 */
export function CloudSyncBadge({
  designId,
  api,
  onNotify,
}: CloudSyncBadgeProps): ReactElement | null {
  const { enabled, session } = useAuth();
  const projectSyncEnabled = useCloudPrefs((s) => s.projectSyncEnabled);
  const [link, setLink] = useState<CloudLink | null>(null);
  const [linking, setLinking] = useState(false);
  // One auto-link attempt per design per mount (the backend call is idempotent
  // on an existing link, but this avoids redundant requests on re-render).
  const attemptedRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!designId) {
      setLink(null);
      return;
    }
    try {
      const { link } = await api.getCloudLink(designId);
      setLink(link);
    } catch {
      setLink(null);
    }
  }, [designId, api]);

  useEffect(() => {
    attemptedRef.current = null;
    void refresh();
  }, [refresh]);

  // Auto-link: when signed in with project sync on, push the design to the
  // cloud (seeds existing content + streams future edits).
  useEffect(() => {
    if (!enabled || !session || !projectSyncEnabled || !designId) return;
    if (link || linking) return;
    if (attemptedRef.current === designId) return;
    attemptedRef.current = designId;
    setLinking(true);
    void api
      .linkDesignToCloud(designId)
      .then(() => refresh())
      .catch((err) => {
        onNotify(
          `Cloud sync failed: ${err instanceof Error ? err.message : String(err)}`,
          "error",
        );
      })
      .finally(() => setLinking(false));
  }, [
    enabled,
    session,
    projectSyncEnabled,
    designId,
    link,
    linking,
    api,
    refresh,
    onNotify,
  ]);

  if (!enabled) return null;
  if (!session) {
    return (
      <span
        className="text-xs text-slate-400"
        title="Sign in via Settings → Account to enable cloud sync"
      >
        cloud: signed-out
      </span>
    );
  }
  if (!projectSyncEnabled) {
    return (
      <span
        className="text-xs text-slate-400"
        title="Project sync is off — turn it on in Settings → Account"
      >
        cloud: sync off
      </span>
    );
  }
  if (!designId) return null;

  if (!link) {
    return (
      <span className="text-xs text-slate-400" title="Syncing to cloud…">
        {linking ? "cloud: syncing…" : "cloud: …"}
      </span>
    );
  }

  const conflict = link.lastError?.startsWith("REVISION_CONFLICT") ?? false;
  const failing = link.failedAttempts > 0;
  const statusClass = conflict
    ? "text-xs text-rose-600 dark:text-rose-400"
    : failing
      ? "text-xs text-amber-600 dark:text-amber-400"
      : "text-xs text-emerald-600 dark:text-emerald-400";
  const statusText = conflict
    ? "cloud: conflict"
    : failing
      ? `cloud: error (${link.failedAttempts}×)`
      : `cloud: rev ${link.lastSyncedRevision}`;
  const statusTitle = conflict
    ? `${link.lastError}`
    : failing
      ? `Last error: ${link.lastError ?? "unknown"}`
      : `Cloud rev: ${link.lastSyncedRevision} (linked ${link.cloudDesignId.slice(0, 8)}…)`;

  return (
    <span className={statusClass} title={statusTitle}>
      {statusText}
    </span>
  );
}
