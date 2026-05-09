import { ArrowLeft, Copy, Lock, Upload } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import {
  FootprintPreviewCanvas,
  SymbolPreviewCanvas,
} from "../../../shared/frontend/canvas/preview";
import type {
  FootprintRenderModel,
  SymbolRenderModel,
} from "../../../shared/rendering";
import type { ComponentDetailPayload } from "./types";
import { ThreeDComponentPreview } from "./three-d/ThreeDComponentPreview";
import {
  uploadFootprintStepModel,
  validateStepUploadFile,
} from "./three-d/model-conversion";
import { toUserError } from "./utils";

export { uploadFootprintStepModel, validateStepUploadFile };

type UploadStatus = "idle" | "converting" | "uploading" | "ready";

function asSymbolRender(value: unknown): SymbolRenderModel | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as { kind?: unknown };
  return record.kind === "symbol" ? (value as SymbolRenderModel) : null;
}

function asFootprintRender(value: unknown): FootprintRenderModel | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as { kind?: unknown };
  return record.kind === "footprint" ? (value as FootprintRenderModel) : null;
}

export function ComponentDetailPage({
  backendURL,
  moduleId,
  componentId,
  onBack,
  onCloned,
  modelRefreshToken: externalModelRefreshToken = 0,
}: {
  backendURL: string | null | undefined;
  moduleId: string;
  componentId: string;
  onBack: () => void;
  onCloned?: (newComponentId: string) => void;
  modelRefreshToken?: number;
}): ReactElement {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ComponentDetailPayload | null>(null);
  const [cloning, setCloning] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [modelRefreshToken, setModelRefreshToken] = useState(0);

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
            toUserError(
              payload,
              `Detail fetch failed (HTTP ${response.status})`,
            ),
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
    () => asSymbolRender(detail?.symbol.preview),
    [detail?.symbol.preview],
  );
  const footprintPreview = useMemo(
    () => asFootprintRender(detail?.footprint.preview),
    [detail?.footprint.preview],
  );
  const isPlaceholderFootprint =
    detail?.component.tags.some(
      (tag) => tag.toLowerCase() === "placeholder-footprint",
    ) ?? false;
  const isBuiltin = detail?.component.isBuiltin ?? false;
  const componentCategory =
    detail?.component.tags.find(
      (tag) => tag.toLowerCase() !== "placeholder-footprint",
    ) ??
    detail?.component.name ??
    "component";

  const handleClone = useCallback(async () => {
    if (!backendURL || !detail) return;
    setCloning(true);
    setError(null);
    try {
      const response = await fetch(
        `${backendURL}/api/modules/${moduleId}/components/${componentId}/clone`,
        { method: "POST" },
      );
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        data?: { componentId?: string };
      } | null;
      if (!response.ok || !payload?.ok || !payload.data?.componentId) {
        throw new Error(
          toUserError(payload, `Clone failed (HTTP ${response.status})`),
        );
      }
      onCloned?.(payload.data.componentId);
    } catch (cloneError) {
      setError(
        cloneError instanceof Error
          ? cloneError.message
          : "Failed to duplicate component",
      );
    } finally {
      setCloning(false);
    }
  }, [backendURL, componentId, detail, moduleId, onCloned]);

  const handleStepUpload = useCallback(
    async (file: File | null | undefined) => {
      if (!file || !backendURL || !detail || isBuiltin) {
        return;
      }
      const validationError = validateStepUploadFile(file);
      if (validationError) {
        setUploadError(validationError);
        setUploadStatus("idle");
        return;
      }

      setUploadError(null);
      setUploadStatus("converting");
      const controller = new AbortController();
      try {
        await uploadFootprintStepModel({
          backendURL,
          moduleId,
          footprintId: detail.footprint.id,
          stepFile: file,
          signal: controller.signal,
          onProgress: (status) => {
            if (
              status === "converting" ||
              status === "uploading" ||
              status === "ready"
            ) {
              setUploadStatus(status);
            }
          },
        });
        setModelRefreshToken((token) => token + 1);
      } catch (stepUploadError) {
        if (controller.signal.aborted) {
          return;
        }
        setUploadStatus("idle");
        setUploadError(
          stepUploadError instanceof Error
            ? stepUploadError.message
            : "Failed to upload STEP model",
        );
      }
    },
    [backendURL, detail, isBuiltin, moduleId],
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
          {loading
            ? "Loading component..."
            : (detail?.component.name ?? "Component")}
        </h1>
        {detail && (
          <div className="ml-auto flex items-center gap-2">
            {isBuiltin && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                <Lock className="h-3 w-3" />
                Core
              </span>
            )}
            <button
              type="button"
              onClick={() => void handleClone()}
              disabled={cloning || !backendURL}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-3 text-sm font-medium text-violet-700 transition-colors hover:bg-violet-50 disabled:opacity-50 dark:border-violet-700 dark:bg-slate-800 dark:text-violet-300 dark:hover:bg-slate-700"
            >
              <Copy className="h-4 w-4" />
              {cloning ? "Duplicating..." : "Duplicate"}
            </button>
          </div>
        )}
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
            {isBuiltin && (
              <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-200">
                <strong className="font-semibold">Built-in component.</strong>{" "}
                Read-only. Click Duplicate to create an editable copy in your
                library.
              </div>
            )}
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

            <div
              className="grid gap-4 lg:grid-cols-3"
              data-testid="library-preview-cards"
            >
              <article className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <header className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Symbol
                  </h3>
                </header>
                <div className="h-64 overflow-hidden rounded-xl border border-slate-200 bg-slate-900 dark:border-slate-800">
                  <SymbolPreviewCanvas model={symbolPreview} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                  <dt className="text-slate-500 dark:text-slate-400">Name</dt>
                  <dd className="text-slate-800 dark:text-slate-200">
                    {detail.symbol.name}
                  </dd>
                  <dt className="text-slate-500 dark:text-slate-400">
                    Reference
                  </dt>
                  <dd className="text-slate-800 dark:text-slate-200">
                    {detail.symbol.referencePrefix ?? "—"}
                  </dd>
                  <dt className="text-slate-500 dark:text-slate-400">Pins</dt>
                  <dd className="text-slate-800 dark:text-slate-200">
                    {detail.symbol.pinCount}
                  </dd>
                  <dt className="text-slate-500 dark:text-slate-400">
                    Warnings
                  </dt>
                  <dd className="text-slate-800 dark:text-slate-200">
                    {detail.symbol.warnings.length}
                  </dd>
                </dl>
              </article>

              <article className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <header className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Footprint
                  </h3>
                  {isPlaceholderFootprint ? (
                    <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300">
                      No footprint yet
                    </span>
                  ) : null}
                </header>
                <div
                  className="h-64 overflow-hidden rounded-xl border border-slate-200 bg-slate-900 dark:border-slate-800"
                  data-testid="footprint-preview-canvas"
                >
                  <FootprintPreviewCanvas model={footprintPreview} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-2 gap-y-1 text-xs">
                  <dt className="text-slate-500 dark:text-slate-400">Name</dt>
                  <dd className="text-slate-800 dark:text-slate-200">
                    {detail.footprint.name}
                    {isPlaceholderFootprint ? " (No footprint yet)" : ""}
                  </dd>
                  <dt className="text-slate-500 dark:text-slate-400">Mount</dt>
                  <dd
                    className="text-slate-800 dark:text-slate-200"
                    data-testid="component-mount-type"
                  >
                    {detail.footprint.mountType ?? "—"}
                  </dd>
                  <dt className="text-slate-500 dark:text-slate-400">Pads</dt>
                  <dd
                    className="text-slate-800 dark:text-slate-200"
                    data-testid="component-pad-count"
                  >
                    {detail.footprint.padCount}
                  </dd>
                  <dt className="text-slate-500 dark:text-slate-400">
                    Package
                  </dt>
                  <dd className="text-slate-800 dark:text-slate-200">
                    {detail.footprint.packageCode.metric ??
                      detail.footprint.packageCode.imperial ??
                      "—"}
                  </dd>
                  <dt className="text-slate-500 dark:text-slate-400">
                    Warnings
                  </dt>
                  <dd className="text-slate-800 dark:text-slate-200">
                    {detail.footprint.warnings.length}
                  </dd>
                </dl>
              </article>

              <article
                className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                data-testid="library-component-3d-card"
              >
                <header className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    3D
                  </h3>
                  {!isBuiltin && !isPlaceholderFootprint ? (
                    <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-3 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-50 dark:border-violet-700 dark:bg-slate-800 dark:text-violet-300 dark:hover:bg-slate-700">
                      <Upload className="h-3.5 w-3.5" />
                      Upload STEP
                      <input
                        type="file"
                        accept=".step,.stp"
                        className="hidden"
                        disabled={
                          uploadStatus === "converting" ||
                          uploadStatus === "uploading"
                        }
                        onChange={(event) => {
                          void handleStepUpload(
                            event.currentTarget.files?.[0] ?? null,
                          );
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  ) : null}
                </header>
                {uploadStatus !== "idle" ? (
                  <span
                    className="mb-2 text-xs text-slate-500 dark:text-slate-400"
                    data-testid="library-3d-upload-progress"
                  >
                    {uploadStatus === "converting"
                      ? "Converting 3D model…"
                      : uploadStatus === "uploading"
                        ? "Uploading GLB…"
                        : "Ready"}
                  </span>
                ) : null}
                {uploadError ? (
                  <div
                    className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                    data-testid="library-3d-upload-error"
                  >
                    {uploadError}
                  </div>
                ) : null}
                {isPlaceholderFootprint ? (
                  <div className="flex h-64 items-center justify-center rounded-xl border border-slate-200 bg-slate-900 px-4 text-center text-xs text-slate-400 dark:border-slate-800">
                    Add a footprint to enable 3D preview.
                  </div>
                ) : (
                  <ThreeDComponentPreview
                    key={`${modelRefreshToken}:${externalModelRefreshToken}`}
                    backendURL={backendURL}
                    moduleId={moduleId}
                    footprintId={detail.footprint.id}
                    category={componentCategory}
                    mountType={detail.footprint.mountType}
                    isBuiltin={isBuiltin}
                  />
                )}
              </article>
            </div>

            {detail.footprintVariants && detail.footprintVariants.length > 1 ? (
              <div
                className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
                data-testid="component-footprint-variants"
              >
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Footprint variants
                </h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  This component can use any of the{" "}
                  {detail.footprintVariants.length} footprints below. The
                  default is preselected when placing a new instance;
                  per-placement override coming soon.
                </p>
                <ul className="mt-3 divide-y divide-slate-200 dark:divide-slate-800">
                  {detail.footprintVariants
                    .slice()
                    .sort((a, b) => a.sortOrder - b.sortOrder)
                    .map((variant) => (
                      <li
                        key={variant.footprintId}
                        className="flex items-center justify-between gap-4 py-2"
                        data-testid={`component-footprint-variant-${variant.footprintId}`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-xs font-medium text-slate-800 dark:text-slate-200">
                              {variant.variantLabel}
                            </span>
                            {variant.isDefault ? (
                              <span className="rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wider text-violet-700 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300">
                                Default
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 truncate text-[0.6875rem] text-slate-500 dark:text-slate-400">
                            {variant.name}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 text-[0.6875rem] text-slate-500 dark:text-slate-400">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-800">
                            {variant.mountType ?? "—"}
                          </span>
                          <span>{variant.padCount} pads</span>
                        </div>
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
          </section>
        )}
      </main>
    </div>
  );
}
