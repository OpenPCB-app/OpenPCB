import { useCallback, useEffect, useState, type ReactElement } from "react";
import { useAuth } from "@/cloud/AuthProvider";

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

export function CloudSyncBadge({
  designId,
  api,
  onNotify,
}: CloudSyncBadgeProps): ReactElement | null {
  const { enabled, session } = useAuth();
  const [link, setLink] = useState<CloudLink | null>(null);
  const [busy, setBusy] = useState(false);

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
    void refresh();
  }, [refresh]);

  const onLink = useCallback(async () => {
    if (!designId) return;
    setBusy(true);
    try {
      await api.linkDesignToCloud(designId);
      onNotify("Linked to cloud", "success");
      await refresh();
    } catch (err) {
      onNotify(
        `Cloud link failed: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    } finally {
      setBusy(false);
    }
  }, [api, designId, onNotify, refresh]);

  const onUnlink = useCallback(async () => {
    if (!designId) return;
    if (
      !window.confirm(
        "Unlink this design from cloud? The cloud copy is kept, but local changes will no longer sync.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await api.unlinkDesignFromCloud(designId);
      onNotify("Unlinked from cloud", "info");
      await refresh();
    } catch (err) {
      onNotify(
        `Unlink failed: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    } finally {
      setBusy(false);
    }
  }, [api, designId, onNotify, refresh]);

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
  if (!designId) return null;

  if (!link) {
    return (
      <button
        type="button"
        onClick={() => void onLink()}
        disabled={busy}
        className="rounded-sm border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        title="Push this design to the cloud"
      >
        {busy ? "Linking…" : "Link to Cloud"}
      </button>
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
    <span className="inline-flex items-center gap-1">
      <span className={statusClass} title={statusTitle}>
        {statusText}
      </span>
      <button
        type="button"
        onClick={() => void onUnlink()}
        disabled={busy}
        className="rounded-sm px-1 text-xs text-slate-400 hover:text-slate-600 disabled:opacity-50 dark:hover:text-slate-200"
        title="Unlink from cloud"
      >
        Unlink
      </button>
    </span>
  );
}
