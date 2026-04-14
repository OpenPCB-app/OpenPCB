import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { X } from "lucide-react";
import {
  FootprintPreviewCanvas,
  SymbolPreviewCanvas,
} from "../../../shared/frontend/canvas/preview";
import type { InspectPayload } from "./types";

function toUserError(response: unknown, fallback: string): string {
  if (!response || typeof response !== "object") {
    return fallback;
  }
  const payload = response as {
    error?: unknown;
    detail?: unknown;
    title?: unknown;
    message?: unknown;
  };
  if (typeof payload.error === "string" && payload.error.length > 0) {
    return payload.error;
  }
  if (typeof payload.detail === "string" && payload.detail.length > 0) {
    return payload.detail;
  }
  if (typeof payload.message === "string" && payload.message.length > 0) {
    return payload.message;
  }
  if (typeof payload.title === "string" && payload.title.length > 0) {
    return payload.title;
  }
  return fallback;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function fileSignature(file: File | null): string {
  if (!file) {
    return "";
  }
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function filesSignature(files: File[]): string {
  return files
    .map((file) => fileSignature(file))
    .sort()
    .join("|");
}

export function ImportWizard({
  backendURL,
  moduleId,
  open,
  onClose,
  onImported,
}: {
  backendURL: string | null | undefined;
  moduleId: string;
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}): ReactElement | null {
  const [symbolFile, setSymbolFile] = useState<File | null>(null);
  const [footprintFiles, setFootprintFiles] = useState<File[]>([]);
  const [inspectData, setInspectData] = useState<InspectPayload | null>(null);
  const [selectedSymbolId, setSelectedSymbolId] = useState("");
  const [selectedFootprintId, setSelectedFootprintId] = useState("");
  const [componentName, setComponentName] = useState("");
  const [description, setDescription] = useState("");
  const [loadingInspect, setLoadingInspect] = useState(false);
  const [loadingCommit, setLoadingCommit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const inspectAbortRef = useRef<AbortController | null>(null);
  const commitAbortRef = useRef<AbortController | null>(null);

  const symbolSig = useMemo(() => fileSignature(symbolFile), [symbolFile]);
  const footprintSig = useMemo(() => filesSignature(footprintFiles), [footprintFiles]);

  const resetForm = () => {
    setSymbolFile(null);
    setFootprintFiles([]);
    setInspectData(null);
    setSelectedSymbolId("");
    setSelectedFootprintId("");
    setComponentName("");
    setDescription("");
    setLoadingInspect(false);
    setLoadingCommit(false);
    setError(null);
  };

  useEffect(() => {
    return () => {
      inspectAbortRef.current?.abort();
      commitAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (open) {
      return;
    }
    inspectAbortRef.current?.abort();
    commitAbortRef.current?.abort();
    resetForm();
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setInspectData(null);
    setSelectedSymbolId("");
    setSelectedFootprintId("");
    setError(null);
  }, [open, symbolSig, footprintSig]);

  if (!open) {
    return null;
  }

  const canInspect = !loadingInspect && !!symbolFile && footprintFiles.length > 0;
  const canCommit =
    !!inspectData &&
    !loadingCommit &&
    selectedSymbolId.trim().length > 0 &&
    selectedFootprintId.trim().length > 0 &&
    componentName.trim().length > 0;

  const selectedSymbol = inspectData?.symbols.find(
    (symbol) => symbol.id === selectedSymbolId,
  );
  const selectedFootprint = inspectData?.footprints.find(
    (footprint) => footprint.id === selectedFootprintId,
  );
  const symbolWarningCount = inspectData
    ? inspectData.warnings.filter((warning) => warning.scope === "symbol").length
    : 0;
  const footprintWarningCount = inspectData
    ? inspectData.warnings.filter((warning) => warning.scope === "footprint").length
    : 0;
  const selectedWarningCount = inspectData
    ? inspectData.warnings.filter(
        (warning) =>
          warning.itemId === selectedSymbolId ||
          warning.itemId === selectedFootprintId,
      ).length
    : 0;

  const inspectUrl = backendURL
    ? `${backendURL}/api/modules/${moduleId}/imports/kicad/inspect`
    : null;
  const commitUrl = backendURL
    ? `${backendURL}/api/modules/${moduleId}/imports/kicad`
    : null;

  const runInspect = async () => {
    if (!canInspect || !inspectUrl || !symbolFile) {
      return;
    }
    inspectAbortRef.current?.abort();
    const controller = new AbortController();
    inspectAbortRef.current = controller;

    setError(null);
    setLoadingInspect(true);
    try {
      const symbolLibrary = {
        fileName: symbolFile.name,
        content: await symbolFile.text(),
      };
      const footprints = await Promise.all(
        footprintFiles.map(async (file) => ({
          fileName: file.name,
          content: await file.text(),
        })),
      );

      const response = await fetch(inspectUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbolLibrary, footprints }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        data?: InspectPayload;
        error?: string;
      };
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(toUserError(payload, `Inspect failed (HTTP ${response.status})`));
      }

      const symbols = payload.data.symbols;
      const fps = payload.data.footprints;
      if (symbols.length === 0 || fps.length === 0) {
        throw new Error("Inspect returned no importable symbol or footprint");
      }

      setInspectData(payload.data);
      setSelectedSymbolId(symbols[0]!.id);
      setSelectedFootprintId(fps[0]!.id);
      setComponentName(symbols[0]!.name);
      setDescription(symbols[0]!.description ?? "");
    } catch (inspectError) {
      if (isAbortError(inspectError)) {
        return;
      }
      setInspectData(null);
      setError(
        inspectError instanceof Error
          ? inspectError.message
          : "Failed to inspect KiCad files",
      );
    } finally {
      if (!controller.signal.aborted) {
        setLoadingInspect(false);
      }
      if (inspectAbortRef.current === controller) {
        inspectAbortRef.current = null;
      }
    }
  };

  const runCommit = async () => {
    if (!canCommit || !commitUrl || !symbolFile) {
      return;
    }
    commitAbortRef.current?.abort();
    const controller = new AbortController();
    commitAbortRef.current = controller;

    setError(null);
    setLoadingCommit(true);
    try {
      const symbolLibrary = {
        fileName: symbolFile.name,
        content: await symbolFile.text(),
      };
      const footprints = await Promise.all(
        footprintFiles.map(async (file) => ({
          fileName: file.name,
          content: await file.text(),
        })),
      );

      const response = await fetch(commitUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbolLibrary,
          footprints,
          selection: {
            symbolId: selectedSymbolId,
            footprintId: selectedFootprintId,
          },
          component: {
            name: componentName.trim(),
            description: description.trim(),
          },
        }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(toUserError(payload, `Import failed (HTTP ${response.status})`));
      }
      onImported();
      onClose();
    } catch (commitError) {
      if (isAbortError(commitError)) {
        return;
      }
      setError(
        commitError instanceof Error
          ? commitError.message
          : "Failed to import component",
      );
    } finally {
      if (!controller.signal.aborted) {
        setLoadingCommit(false);
      }
      if (commitAbortRef.current === controller) {
        commitAbortRef.current = null;
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Import component from KiCad
          </h2>
          <button
            type="button"
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-slate-700 dark:text-slate-300">Symbol library (.kicad_sym)</span>
              <input
                type="file"
                accept=".kicad_sym"
                onChange={(event) =>
                  setSymbolFile(event.target.files?.[0] ? event.target.files[0] : null)
                }
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              />
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-slate-700 dark:text-slate-300">Footprints (.kicad_mod)</span>
              <input
                type="file"
                accept=".kicad_mod"
                multiple
                onChange={(event) =>
                  setFootprintFiles(
                    event.target.files ? Array.from(event.target.files) : [],
                  )
                }
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              />
            </label>
          </div>

          <div>
            <button
              type="button"
              onClick={runInspect}
              disabled={!canInspect}
              className="inline-flex h-9 items-center rounded-lg border border-violet-600 bg-violet-600 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loadingInspect ? "Inspecting..." : "Inspect files"}
            </button>
          </div>

          {inspectData && (
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="text-slate-700 dark:text-slate-300">Symbol</span>
                  <select
                    className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    value={selectedSymbolId}
                    onChange={(event) => {
                      const value = event.target.value;
                      setSelectedSymbolId(value);
                      const selected = inspectData.symbols.find(
                        (symbol) => symbol.id === value,
                      );
                      if (selected && componentName.trim().length === 0) {
                        setComponentName(selected.name);
                      }
                    }}
                  >
                    {inspectData.symbols.map((symbol) => (
                      <option key={symbol.id} value={symbol.id}>
                        {symbol.name} ({symbol.pinCount} pins)
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1 text-sm">
                  <span className="text-slate-700 dark:text-slate-300">Footprint</span>
                  <select
                    className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    value={selectedFootprintId}
                    onChange={(event) => setSelectedFootprintId(event.target.value)}
                  >
                    {inspectData.footprints.map((footprint) => (
                      <option key={footprint.id} value={footprint.id}>
                        {footprint.name} ({footprint.padCount} pads)
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <div className="text-xs text-slate-600 dark:text-slate-400">Symbol preview</div>
                  <div className="h-44 overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700">
                    <SymbolPreviewCanvas model={selectedSymbol?.preview ?? null} />
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-xs text-slate-600 dark:text-slate-400">Footprint preview</div>
                  <div className="h-44 overflow-hidden rounded-lg border border-slate-300 dark:border-slate-700">
                    <FootprintPreviewCanvas model={selectedFootprint?.preview ?? null} />
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="text-slate-700 dark:text-slate-300">Component name</span>
                  <input
                    value={componentName}
                    onChange={(event) => setComponentName(event.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </label>

                <label className="space-y-1 text-sm">
                  <span className="text-slate-700 dark:text-slate-300">Description</span>
                  <input
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </label>
              </div>

              <div className="text-xs text-slate-600 dark:text-slate-400">
                {inspectData.warnings.length > 0
                  ? `${inspectData.warnings.length} warnings (${symbolWarningCount} symbol, ${footprintWarningCount} footprint, ${selectedWarningCount} selected)`
                  : "No parser warnings"}
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">
          <button
            type="button"
            className="h-9 rounded-lg border border-slate-300 px-4 text-sm text-slate-700 dark:border-slate-700 dark:text-slate-300"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={runCommit}
            disabled={!canCommit}
            className="h-9 rounded-lg border border-violet-600 bg-violet-600 px-4 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loadingCommit ? "Importing..." : "Import component"}
          </button>
        </div>
      </div>
    </div>
  );
}
