import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  Link2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { useRuntime } from "../../providers/RuntimeProvider";

interface LibrarySourceSummary {
  id: string;
  name: string;
  kind: string;
  isReadOnly: boolean;
  license: string | null;
  homepage: string | null;
  createdAt: string;
  latestVersion: string | null;
  latestChannel: string | null;
  latestInstalledAt: string | null;
  latestSignatureValid: boolean;
  latestInstallOrigin: string | null;
  componentCount: number;
}

type CoreLibraryState =
  | "missing"
  | "up_to_date"
  | "bundled_update_available"
  | "remote_update_available"
  | "error";

interface CoreLibraryReleaseSummary {
  version: string;
  channel: string;
  packageSha256: string;
  signatureValid: boolean;
  installedAt: string;
  componentCount: number;
}

interface CoreLibraryPackageSummary {
  version: string;
  channel: string;
  packageSha256: string;
  signaturePresent: boolean;
  keyId: string | null;
  componentCount: number;
  generatedAt: string;
}

interface CoreLibraryRemoteSummary {
  version: string;
  tagName: string;
  releaseUrl: string;
  opclibAssetName: string;
  publishedAt: string | null;
}

interface CoreLibraryStatusSummary {
  state: CoreLibraryState;
  installed: CoreLibraryReleaseSummary | null;
  bundled: CoreLibraryPackageSummary | null;
  remote?: CoreLibraryRemoteSummary | null;
  error: string | null;
}

async function readErrorDetail(
  res: Response,
  fallback: string,
): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as {
    detail?: string;
    error?: string;
    title?: string;
  };
  return body.detail ?? body.error ?? body.title ?? fallback;
}

async function fetchSources(base: string): Promise<LibrarySourceSummary[]> {
  const res = await fetch(`${base}/sources`);
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, `HTTP ${res.status}`));
  }
  const body = (await res.json()) as {
    data: { sources: LibrarySourceSummary[] };
  };
  return body.data.sources;
}

async function installFromFile(base: string, file: File): Promise<void> {
  const buf = await file.arrayBuffer();
  const res = await fetch(`${base}/sources/install`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: buf,
  });
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, `HTTP ${res.status}`));
  }
}

async function installFromUrl(base: string, url: string): Promise<void> {
  const res = await fetch(`${base}/sources/install`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, `HTTP ${res.status}`));
  }
}

async function deleteSource(base: string, id: string): Promise<void> {
  const res = await fetch(`${base}/sources/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    throw new Error(await readErrorDetail(res, `HTTP ${res.status}`));
  }
}

async function fetchCoreStatus(base: string): Promise<CoreLibraryStatusSummary> {
  const res = await fetch(`${base}/core-library/status`);
  if (!res.ok) throw new Error(await readErrorDetail(res, `HTTP ${res.status}`));
  const body = (await res.json()) as {
    data: { status: CoreLibraryStatusSummary };
  };
  return body.data.status;
}

async function checkCoreUpdates(base: string): Promise<CoreLibraryStatusSummary> {
  const res = await fetch(`${base}/core-library/check`, { method: "POST" });
  if (!res.ok) throw new Error(await readErrorDetail(res, `HTTP ${res.status}`));
  const body = (await res.json()) as {
    data: { result: CoreLibraryStatusSummary };
  };
  return body.data.result;
}

async function updateCoreLibrary(base: string): Promise<CoreLibraryStatusSummary> {
  const res = await fetch(`${base}/core-library/update`, { method: "POST" });
  if (!res.ok) throw new Error(await readErrorDetail(res, `HTTP ${res.status}`));
  const body = (await res.json()) as {
    data: { result: CoreLibraryStatusSummary };
  };
  return body.data.result;
}

export function LibrariesPanel() {
  const { backendURL } = useRuntime();
  const base = useMemo(
    () => (backendURL ? `${backendURL}/api/modules/library` : null),
    [backendURL],
  );
  const [sources, setSources] = useState<LibrarySourceSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [coreBusy, setCoreBusy] = useState<"check" | "update" | null>(null);
  const [coreStatus, setCoreStatus] = useState<CoreLibraryStatusSummary | null>(
    null,
  );
  const [urlPrompt, setUrlPrompt] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!base) return;
    try {
      const [nextSources, nextCoreStatus] = await Promise.all([
        fetchSources(base),
        fetchCoreStatus(base),
      ]);
      setSources(nextSources);
      setCoreStatus(nextCoreStatus);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [base]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleFile = async (file: File) => {
    if (!base) return;
    setBusy(true);
    setError(null);
    try {
      await installFromFile(base, file);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleUrl = async () => {
    if (!base || !urlValue.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await installFromUrl(base, urlValue.trim());
      setUrlValue("");
      setUrlPrompt(false);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!base) return;
    if (
      !window.confirm(
        `Remove library "${id}" and all its components? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await deleteSource(base, id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleCoreCheck = async () => {
    if (!base) return;
    setCoreBusy("check");
    setError(null);
    try {
      setCoreStatus(await checkCoreUpdates(base));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCoreBusy(null);
    }
  };

  const handleCoreUpdate = async () => {
    if (!base) return;
    setCoreBusy("update");
    setError(null);
    try {
      await updateCoreLibrary(base);
      window.dispatchEvent(new CustomEvent("openpcb:library-updated"));
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCoreBusy(null);
    }
  };

  return (
    <div className="space-y-6 pb-24 text-slate-900 dark:text-slate-100">
      <div>
        <h2 className="text-lg font-semibold">Libraries</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Component libraries installed in this workspace. The core library
          ships with OpenPCB; install additional <code>.opclib</code> packages
          from file or URL.
        </p>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <CoreLibraryCard
        status={coreStatus}
        busy={coreBusy}
        disabled={busy || coreBusy !== null}
        onCheck={() => void handleCoreCheck()}
        onUpdate={() => void handleCoreUpdate()}
      />

      <div className="flex flex-wrap gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".opclib"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            if (e.target) e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          <Upload className="h-4 w-4" />
          Install from file…
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setUrlPrompt((s) => !s)}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"
        >
          <Link2 className="h-4 w-4" />
          Install from URL…
        </button>
      </div>

      {urlPrompt ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900">
          <input
            type="url"
            placeholder="https://github.com/.../release.opclib"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            className="min-w-[20rem] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
          <button
            type="button"
            disabled={busy || !urlValue.trim()}
            onClick={() => void handleUrl()}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
          >
            Install
          </button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2">Source</th>
              <th className="px-4 py-2">Version</th>
              <th className="px-4 py-2">Components</th>
              <th className="px-4 py-2">Signed</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {sources === null ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-6 text-center text-slate-500"
                >
                  Loading…
                </td>
              </tr>
            ) : sources.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-6 text-center text-slate-500"
                >
                  No libraries installed.
                </td>
              </tr>
            ) : (
              sources.map((s) => (
                <tr
                  key={s.id}
                  className="border-t border-slate-100 dark:border-slate-800"
                >
                  <td className="px-4 py-2">
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-slate-500">{s.id}</div>
                    <div className="mt-0.5 text-xs">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {s.kind}
                      </span>
                      {s.isReadOnly ? (
                        <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                          read-only
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-4 py-2 align-top">
                    {s.latestVersion ? (
                      <div>
                        <div>{s.latestVersion}</div>
                        <div className="text-xs text-slate-500">
                          {s.latestChannel ?? ""}
                        </div>
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 align-top">{s.componentCount}</td>
                  <td className="px-4 py-2 align-top">
                    {s.latestVersion === null ? (
                      <span className="text-slate-400">—</span>
                    ) : s.latestSignatureValid ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                        <ShieldCheck className="h-4 w-4" /> verified
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                        <ShieldAlert className="h-4 w-4" /> unsigned
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right align-top">
                    {s.kind === "core" ? null : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDelete(s.id)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-red-950/40"
                        title="Remove this library"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CoreLibraryCard({
  status,
  busy,
  disabled,
  onCheck,
  onUpdate,
}: {
  status: CoreLibraryStatusSummary | null;
  busy: "check" | "update" | null;
  disabled: boolean;
  onCheck: () => void;
  onUpdate: () => void;
}) {
  const installed = status?.installed;
  const bundled = status?.bundled;
  const remote = status?.remote ?? null;
  const updateVersion =
    status?.state === "remote_update_available"
      ? remote?.version
      : status?.state === "bundled_update_available"
        ? bundled?.version
        : null;
  const canUpdate = status?.state === "remote_update_available";
  const stateLabel = status ? formatCoreState(status.state) : "Loading…";

  return (
    <section className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4 dark:border-violet-900/60 dark:bg-violet-950/20">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">OpenPCB Core Library</h3>
            <span className="rounded-full bg-white px-2 py-0.5 text-xs text-violet-700 dark:bg-violet-950 dark:text-violet-200">
              {stateLabel}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            Official symbols, footprints, component variants, and 3D models.
          </p>
          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <CoreFact label="Installed" value={installed?.version ?? "—"} />
            <CoreFact
              label="Components"
              value={installed ? String(installed.componentCount) : "—"}
            />
            <CoreFact
              label="Signature"
              value={
                installed
                  ? installed.signatureValid
                    ? "verified"
                    : "unsigned"
                  : "—"
              }
            />
            <CoreFact
              label="Latest stable"
              value={remote?.version ?? bundled?.version ?? "—"}
            />
          </dl>
          {status?.error ? (
            <p className="mt-2 text-xs text-red-600 dark:text-red-300">
              {status.error}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={onCheck}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`h-4 w-4 ${busy === "check" ? "animate-spin" : ""}`} />
            {busy === "check" ? "Checking…" : "Check for updates"}
          </button>
          <button
            type="button"
            disabled={disabled || !canUpdate}
            onClick={onUpdate}
            className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
            title={canUpdate ? undefined : "Run check first; updates install latest stable remote release."}
          >
            <Download className="h-4 w-4" />
            {busy === "update"
              ? "Downloading…"
              : updateVersion
                ? `Download ${updateVersion}`
                : "Download update"}
          </button>
        </div>
      </div>
    </section>
  );
}

function CoreFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-800 dark:text-slate-100">
        {value}
      </dd>
    </div>
  );
}

function formatCoreState(state: CoreLibraryState): string {
  switch (state) {
    case "missing":
      return "Missing";
    case "up_to_date":
      return "Up to date";
    case "bundled_update_available":
      return "Bundled update available";
    case "remote_update_available":
      return "Update available";
    case "error":
      return "Check failed";
  }
}
