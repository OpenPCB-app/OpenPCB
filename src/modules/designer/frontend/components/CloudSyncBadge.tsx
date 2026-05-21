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
  const { enabled, session, tier } = useAuth();
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
        disabled={busy || tier !== "pro"}
        className="rounded-sm border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        title={
          tier === "pro" ? "Push this design to the cloud" : "Pro tier required"
        }
      >
        {busy ? "Linking…" : "Link to Cloud"}
      </button>
    );
  }

  const failing = link.failedAttempts > 0;
  return (
    <span
      className={
        failing
          ? "text-xs text-amber-600 dark:text-amber-400"
          : "text-xs text-emerald-600 dark:text-emerald-400"
      }
      title={
        failing
          ? `Last error: ${link.lastError ?? "unknown"}`
          : `Cloud rev: ${link.lastSyncedRevision} (linked ${link.cloudDesignId.slice(0, 8)}…)`
      }
    >
      {failing
        ? `cloud: error (${link.failedAttempts}×)`
        : `cloud: rev ${link.lastSyncedRevision}`}
    </span>
  );
}
