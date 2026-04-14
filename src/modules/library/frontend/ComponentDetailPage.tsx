import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import {
  FootprintPreviewCanvas,
  SymbolPreviewCanvas,
} from "../../../shared/frontend/canvas/preview";
import type {
  FootprintPreviewModel,
  SymbolPreviewModel,
} from "../../../shared/rendering";
import type { ComponentDetailPayload } from "./types";

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

function asSymbolPreview(value: unknown): SymbolPreviewModel | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as { kind?: unknown };
  return record.kind === "symbol" ? (value as SymbolPreviewModel) : null;
}

function asFootprintPreview(value: unknown): FootprintPreviewModel | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as { kind?: unknown };
  return record.kind === "footprint"
    ? (value as FootprintPreviewModel)
    : null;
}

export function ComponentDetailPage({
  backendURL,
  moduleId,
  componentId,
  onBack,
}: {
  backendURL: string | null | undefined;
  moduleId: string;
  componentId: string;
  onBack: () => void;
}): ReactElement {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ComponentDetailPayload | null>(null);

  useEffect(() => {
    if (!backendURL) {
      setLoading(false);
      setError("Backend URL unavailable");
      setDetail(null);
      return;
    }

    const controller = new AbortController();
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `${backendURL}/api/modules/${moduleId}/components/${componentId}/detail`,
          { signal: controller.signal },
        );
        const payload = (await response.json()) as {
          ok?: boolean;
          data?: { detail?: ComponentDetailPayload };
          error?: string;
        };
        if (!response.ok || !payload.ok || !payload.data?.detail) {
          throw new Error(
            toUserError(payload, `Detail fetch failed (HTTP ${response.status})`),
          );
        }
        setDetail(payload.data.detail);
      } catch (fetchError) {
        if (controller.signal.aborted) {
          return;
        }
        setDetail(null);
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load component detail",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => controller.abort();
  }, [backendURL, componentId, moduleId]);

  const symbolPreview = useMemo(
    () => asSymbolPreview(detail?.symbol.preview),
    [detail?.symbol.preview],
  );
  const footprintPreview = useMemo(
    () => asFootprintPreview(detail?.footprint.preview),
    [detail?.footprint.preview],
  );

  return (
    <div className="flex h-full w-full flex-col bg-slate-50 dark:bg-slate-950">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-6 py-3 dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {loading ? "Loading component..." : detail?.component.name ?? "Component"}
        </h1>
      </header>

      <main className="flex-1 overflow-auto p-6">
        {loading && (
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            Loading component detail...
          </div>
        )}

        {!loading && error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        {!loading && !error && detail && (
          <section className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {detail.component.name}
              </h2>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {detail.component.description || "No description"}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {detail.component.tags.length > 0 ? (
                  detail.component.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                    >
                      {tag}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-slate-500 dark:text-slate-400">
                    No tags
                  </span>
                )}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  Symbol preview
                </div>
                <div className="h-64 overflow-hidden rounded-xl border border-slate-200 bg-slate-900 dark:border-slate-800">
                  <SymbolPreviewCanvas model={symbolPreview} />
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  Footprint preview
                </div>
                <div className="h-64 overflow-hidden rounded-xl border border-slate-200 bg-slate-900 dark:border-slate-800">
                  <FootprintPreviewCanvas model={footprintPreview} />
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Symbol metadata
                </h3>
                <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                  <dt className="text-slate-500 dark:text-slate-400">Name</dt>
                  <dd className="text-slate-800 dark:text-slate-200">{detail.symbol.name}</dd>
                  <dt className="text-slate-500 dark:text-slate-400">Reference</dt>
                  <dd className="text-slate-800 dark:text-slate-200">
                    {detail.symbol.referencePrefix ?? "—"}
                  </dd>
                  <dt className="text-slate-500 dark:text-slate-400">Pins</dt>
                  <dd className="text-slate-800 dark:text-slate-200">{detail.symbol.pinCount}</dd>
                  <dt className="text-slate-500 dark:text-slate-400">Warnings</dt>
                  <dd className="text-slate-800 dark:text-slate-200">
                    {detail.symbol.warnings.length}
                  </dd>
                </dl>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Footprint metadata
                </h3>
                <dl className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                  <dt className="text-slate-500 dark:text-slate-400">Name</dt>
                  <dd className="text-slate-800 dark:text-slate-200">
                    {detail.footprint.name}
                  </dd>
                  <dt className="text-slate-500 dark:text-slate-400">Mount</dt>
                  <dd className="text-slate-800 dark:text-slate-200">
                    {detail.footprint.mountType ?? "—"}
                  </dd>
                  <dt className="text-slate-500 dark:text-slate-400">Pads</dt>
                  <dd className="text-slate-800 dark:text-slate-200">
                    {detail.footprint.padCount}
                  </dd>
                  <dt className="text-slate-500 dark:text-slate-400">Package</dt>
                  <dd className="text-slate-800 dark:text-slate-200">
                    {detail.footprint.packageCode.metric ??
                      detail.footprint.packageCode.imperial ??
                      "—"}
                  </dd>
                  <dt className="text-slate-500 dark:text-slate-400">Warnings</dt>
                  <dd className="text-slate-800 dark:text-slate-200">
                    {detail.footprint.warnings.length}
                  </dd>
                </dl>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
