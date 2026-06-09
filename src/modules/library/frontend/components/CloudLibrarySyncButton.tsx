import { useCallback, useState, type ReactElement } from "react";
import { CloudDownload, CloudUpload } from "lucide-react";
import { useAuth } from "@/cloud/AuthProvider";
import { readCloudConfig } from "@/cloud/config";

interface Props {
  backendURL?: string | null;
  moduleId: string;
  /** Called after a successful pull so the caller can refresh the list. */
  onChanged?: () => void;
}

interface SyncResult {
  componentCount: number;
  uploaded: boolean;
}
interface PullResult {
  imported: boolean;
  components: number;
}

/**
 * "Sync to Cloud" (push) + "Pull" for the user's custom component library.
 * Push uploads custom components (is_builtin=0) to the personal cloud workspace
 * as an .opclib pack; pull downloads + imports the latest cloud pack. Hidden
 * when cloud is unavailable or the user is signed out. Token is sent per-request
 * via x-cloud-bearer (never stored), mirroring the designer cloud sync.
 */
export function CloudLibrarySyncButton({
  backendURL,
  moduleId,
  onChanged,
}: Props): ReactElement | null {
  const { enabled, session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const call = useCallback(
    async <T,>(action: "sync" | "pull"): Promise<T | null> => {
      if (!backendURL || !session) return null;
      const cfg = readCloudConfig();
      const res = await fetch(
        `${backendURL}/api/modules/${moduleId}/cloud/${action}`,
        {
          method: "POST",
          headers: {
            "x-cloud-bearer": session.access_token,
            "x-cloud-api-url": cfg.apiUrl,
          },
        },
      );
      const payload = (await res.json().catch(() => null)) as {
        data?: { result?: T };
      } | null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return payload?.data?.result ?? null;
    },
    [backendURL, moduleId, session],
  );

  const sync = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    setFailed(false);
    try {
      const r = await call<SyncResult>("sync");
      setStatus(
        r?.uploaded
          ? `Synced ${r.componentCount} component${r.componentCount === 1 ? "" : "s"}`
          : "No custom components to sync",
      );
    } catch (err) {
      setFailed(true);
      setStatus(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }, [call]);

  const pull = useCallback(async () => {
    setBusy(true);
    setStatus(null);
    setFailed(false);
    try {
      const r = await call<PullResult>("pull");
      setStatus(
        r?.imported ? `Pulled ${r.components} component(s)` : "Nothing to pull",
      );
      if (r?.imported) onChanged?.();
    } catch (err) {
      setFailed(true);
      setStatus(err instanceof Error ? err.message : "Pull failed");
    } finally {
      setBusy(false);
    }
  }, [call, onChanged]);

  if (!enabled || !session) return null;

  return (
    <div className="inline-flex items-center">
      <button
        type="button"
        onClick={() => void sync()}
        disabled={busy || !backendURL}
        title={status ?? "Sync your custom components to OpenPCB Cloud"}
        className="inline-flex h-9 items-center gap-2 rounded-l-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        <CloudUpload className="h-4 w-4" strokeWidth={1.8} />
        <span className={failed ? "text-red-600 dark:text-red-400" : undefined}>
          {busy ? "Syncing…" : (status ?? "Sync to Cloud")}
        </span>
      </button>
      <button
        type="button"
        onClick={() => void pull()}
        disabled={busy || !backendURL}
        title="Pull custom components from OpenPCB Cloud"
        aria-label="Pull custom components from cloud"
        className="inline-flex h-9 items-center rounded-r-lg border border-l-0 border-slate-300 bg-white px-2 text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
      >
        <CloudDownload className="h-4 w-4" strokeWidth={1.8} />
      </button>
    </div>
  );
}
