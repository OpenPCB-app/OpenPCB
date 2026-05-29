import {
  ArrowLeft,
  Copy,
  Lock,
  Maximize2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Upload,
  X,
} from "lucide-react";
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
import type { LibraryComponent } from "../../../sdks/library";
import { useTheme } from "../../../core/frontend/src/providers/ThemeProvider";
import { TagTokenInput } from "./components/TagTokenInput";
import { DetailsCard } from "./components/DetailsCard";
import { FootprintOptionsList } from "./components/FootprintOptionsList";
import { PinsTable } from "./components/PinsTable";
import { PreviewModal } from "./components/PreviewModal";
import { useLibraryTags } from "./hooks/useLibraryTags";
import { useFootprintGeometry } from "./hooks/useFootprintGeometry";
import type { ComponentDetailPayload } from "./types";
import { ThreeDComponentPreview } from "./three-d/ThreeDComponentPreview";
import {
  uploadFootprintStepModel,
  validateStepUploadFile,
} from "./three-d/model-conversion";
import {
  asFootprintRender,
  asSymbolRender,
  formatSourceLabel,
  getDefaultVariant,
  packageLabel,
  splitTags,
} from "./detail-helpers";
import { toUserError } from "./utils";

export { uploadFootprintStepModel, validateStepUploadFile };

type UploadStatus = "idle" | "converting" | "uploading" | "ready";

export function ComponentDetailPage({
  backendURL,
  moduleId,
  componentId,
  onBack,
  onCloned,
  onUpdated,
  modelRefreshToken: externalModelRefreshToken = 0,
}: {
  backendURL: string | null | undefined;
  moduleId: string;
  componentId: string;
  onBack: () => void;
  onCloned?: (newComponentId: string) => void;
  onUpdated?: (component: LibraryComponent) => void;
  modelRefreshToken?: number;
}): ReactElement {
  const { mode: themeMode } = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ComponentDetailPayload | null>(null);
  const [cloning, setCloning] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [modelRefreshToken, setModelRefreshToken] = useState(0);
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tagsRefreshToken, setTagsRefreshToken] = useState(0);
  // Local UI selection — no command, no persistence (spec §6).
  const [selectedFootprintId, setSelectedFootprintId] = useState("");
  const [fullscreen, setFullscreen] = useState<null | "symbol" | "footprint">(
    null,
  );

  const { tags: tagSuggestions } = useLibraryTags({
    backendURL,
    moduleId,
    excludeSystem: true,
    refreshToken: tagsRefreshToken,
  });

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

  // Reset selection to the default footprint whenever the component changes.
  const defaultFootprintId = detail?.footprint.id ?? "";
  useEffect(() => {
    setSelectedFootprintId(defaultFootprintId);
  }, [defaultFootprintId]);

  const effectiveSelectedId = selectedFootprintId || defaultFootprintId;

  const symbolPreview = useMemo(
    () => asSymbolRender(detail?.symbol.preview),
    [detail?.symbol.preview],
  );
  const defaultModel = useMemo(
    () => asFootprintRender(detail?.footprint.preview),
    [detail?.footprint.preview],
  );

  const geometry = useFootprintGeometry({
    backendURL,
    moduleId,
    selectedFootprintId: effectiveSelectedId,
    defaultFootprintId,
    defaultModel,
  });

  const variants = useMemo(
    () => detail?.footprintVariants ?? [],
    [detail?.footprintVariants],
  );
  const hasOptions = variants.length > 1;
  const selectedVariant = useMemo(
    () =>
      variants.find((variant) => variant.footprintId === effectiveSelectedId) ??
      (detail ? getDefaultVariant(detail) : null),
    [variants, effectiveSelectedId, detail],
  );

  const electricalTypeByPin = useMemo(() => {
    const map = new Map<string, string>();
    for (const pin of symbolPreview?.pins ?? []) {
      if (pin.number) {
        map.set(pin.number, pin.electricalType);
      }
    }
    return map;
  }, [symbolPreview]);

  const isPlaceholderFootprint =
    detail?.component.tags.some(
      (tag) => tag.toLowerCase() === "placeholder-footprint",
    ) ?? false;
  const isBuiltin = detail?.component.isBuiltin ?? false;
  const tagSplit = useMemo(
    () => splitTags(detail?.component.tags ?? []),
    [detail?.component.tags],
  );
  const componentCategory =
    tagSplit.semantic[0] ?? detail?.component.name ?? "component";

  const beginEdit = useCallback(() => {
    if (!detail || isBuiltin) return;
    setDraftName(detail.component.name);
    setDraftDescription(detail.component.description);
    setDraftTags([...detail.component.tags]);
    setSaveError(null);
    setEditing(true);
  }, [detail, isBuiltin]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setSaveError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!backendURL || !detail) return;
    const trimmedName = draftName.trim();
    if (trimmedName.length === 0) {
      setSaveError("Name must not be empty");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(
        `${backendURL}/api/modules/${moduleId}/components/${componentId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: trimmedName,
            description: draftDescription,
            tags: draftTags,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        data?: { component?: LibraryComponent };
      } | null;
      if (!response.ok || !payload?.ok || !payload.data?.component) {
        throw new Error(
          toUserError(payload, `Update failed (HTTP ${response.status})`),
        );
      }
      const updated = payload.data.component;
      setDetail((prev) => (prev ? { ...prev, component: updated } : prev));
      setEditing(false);
      setTagsRefreshToken((tick) => tick + 1);
      onUpdated?.(updated);
    } catch (updateError) {
      setSaveError(
        updateError instanceof Error
          ? updateError.message
          : "Failed to update component",
      );
    } finally {
      setSaving(false);
    }
  }, [
    backendURL,
    componentId,
    detail,
    draftDescription,
    draftName,
    draftTags,
    moduleId,
    onUpdated,
  ]);

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
      if (
        !file ||
        !backendURL ||
        !detail ||
        isBuiltin ||
        !effectiveSelectedId
      ) {
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
          footprintId: effectiveSelectedId,
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
    [backendURL, detail, effectiveSelectedId, isBuiltin, moduleId],
  );

  const selectedPackageLabel = selectedVariant
    ? packageLabel(selectedVariant)
    : "—";
  const sourceLabel = detail
    ? formatSourceLabel(
        detail.footprint.provenance ?? detail.symbol.provenance,
        isBuiltin,
      )
    : "—";
  const defaultVariant = detail ? getDefaultVariant(detail) : null;
  // STEP upload is an edit affordance — only surfaced while editing.
  const canUploadStep = !isBuiltin && !isPlaceholderFootprint && editing;

  return (
    <div className="flex h-full w-full flex-col bg-slate-50 dark:bg-slate-950">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-6 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <h1 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {loading
            ? "Loading component..."
            : (detail?.component.name ?? "Component")}
        </h1>
        {detail && isBuiltin && (
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
            <Lock className="h-3 w-3" />
            Core
          </span>
        )}
        {detail && (
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled
              title="Open a design to place"
              className="inline-flex h-9 cursor-not-allowed items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-500 opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
            >
              <Plus className="h-4 w-4" />
              Place in design
            </button>

            {isBuiltin ? (
              <button
                type="button"
                onClick={() => void handleClone()}
                disabled={cloning || !backendURL}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-violet-600 bg-violet-600 px-3 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                <Copy className="h-4 w-4" />
                {cloning ? "Duplicating..." : "Duplicate to edit"}
              </button>
            ) : editing ? (
              <>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={saving || !backendURL}
                  className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-violet-600 bg-violet-600 px-3 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                  data-testid="component-save-button"
                >
                  <Save className="h-4 w-4" />
                  {saving ? "Saving…" : "Save"}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={beginEdit}
                disabled={!backendURL}
                className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-violet-600 bg-violet-600 px-3 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
                data-testid="component-edit-button"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </button>
            )}
          </div>
        )}
      </header>

      <main className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[1380px] px-6 py-6">
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
            <div className="space-y-[18px]">
              {isBuiltin && (
                <p className="flex items-center gap-2 text-[13px] text-slate-500 dark:text-slate-400">
                  <Lock className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
                  <span>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      Read-only built-in.
                    </span>{" "}
                    Duplicate to make an editable copy. Placing is allowed.
                  </span>
                </p>
              )}

              {editing ? (
                <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                  <div className="space-y-3">
                    <div>
                      <label
                        htmlFor="component-edit-name"
                        className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                      >
                        Name
                      </label>
                      <input
                        id="component-edit-name"
                        type="text"
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        maxLength={200}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="component-edit-description"
                        className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400"
                      >
                        Description
                      </label>
                      <textarea
                        id="component-edit-description"
                        value={draftDescription}
                        onChange={(event) =>
                          setDraftDescription(event.target.value)
                        }
                        rows={3}
                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/40 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        maxLength={2000}
                      />
                    </div>
                    <div>
                      <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Tags
                      </span>
                      <div className="mt-1">
                        <TagTokenInput
                          value={draftTags}
                          onChange={setDraftTags}
                          suggestions={tagSuggestions}
                        />
                      </div>
                    </div>
                    {saveError ? (
                      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
                        {saveError}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div>
                  <h2 className="text-[26px] font-bold tracking-tight text-slate-900 dark:text-slate-100">
                    {detail.component.name}
                  </h2>
                  {detail.component.description ? (
                    <p className="mt-1.5 max-w-2xl text-[14.5px] leading-relaxed text-slate-500 dark:text-slate-400">
                      {detail.component.description}
                    </p>
                  ) : null}
                  <div className="mt-3.5 flex flex-wrap items-center gap-2">
                    {tagSplit.semantic.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700 dark:border-violet-800/50 dark:bg-violet-950/40 dark:text-violet-300"
                      >
                        {tag}
                      </span>
                    ))}
                    {tagSplit.provenance.map((chip) => (
                      <span
                        key={chip.tag}
                        className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-dashed border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-400"
                      >
                        {chip.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* ROW 1: Details (wide) | Symbol (narrow) */}
              <div className="grid grid-cols-1 items-stretch gap-[18px] lg:grid-cols-[1.5fr_1fr]">
                <DetailsCard
                  componentName={detail.component.name}
                  defaultFootprintName={
                    defaultVariant?.name ?? detail.footprint.name
                  }
                  optionCount={variants.length}
                  source={sourceLabel}
                  datasheetUrl={null}
                />

                <section className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                    <span className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Symbol
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                        shared across options
                      </span>
                      <button
                        type="button"
                        onClick={() => setFullscreen("symbol")}
                        disabled={!symbolPreview}
                        title="Full screen"
                        aria-label="Open symbol full screen"
                        className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </header>
                  <div className="min-h-[320px] flex-1 overflow-hidden bg-slate-950">
                    <SymbolPreviewCanvas
                      model={symbolPreview}
                      emptyMessage="No symbol preview"
                    />
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
                    <dt className="text-sm text-slate-500 dark:text-slate-400">
                      Reference prefix
                    </dt>
                    <dd className="text-right font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {detail.symbol.referencePrefix || "—"}
                    </dd>
                    <dt className="text-sm text-slate-500 dark:text-slate-400">
                      Pins
                    </dt>
                    <dd className="text-right font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {detail.symbol.pinCount}
                    </dd>
                  </dl>
                </section>
              </div>

              {/* ROW 2: [Options] | Footprint | 3D */}
              <div
                className={`grid grid-cols-1 items-stretch gap-[18px] ${
                  hasOptions ? "lg:grid-cols-3" : "lg:grid-cols-2"
                }`}
              >
                {hasOptions ? (
                  <FootprintOptionsList
                    variants={variants}
                    selectedFootprintId={effectiveSelectedId}
                    onSelect={setSelectedFootprintId}
                    backendURL={backendURL}
                    moduleId={moduleId}
                    themeMode={themeMode}
                  />
                ) : null}

                <section className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                  <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                    <span className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Footprint
                    </span>
                    <div className="flex items-center gap-2">
                      {hasOptions && selectedVariant ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-violet-600 dark:border-violet-800/50 dark:bg-violet-950/40 dark:text-violet-300">
                          <RefreshCw className="h-3 w-3" />
                          {selectedVariant.variantLabel}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setFullscreen("footprint")}
                        disabled={geometry.status !== "ready"}
                        title="Full screen"
                        aria-label="Open footprint full screen"
                        className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      >
                        <Maximize2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </header>
                  <div
                    className="relative min-h-[300px] flex-1 overflow-hidden bg-slate-950"
                    data-testid="footprint-preview-canvas"
                  >
                    {isPlaceholderFootprint ? (
                      <FootprintPreviewCanvas
                        model={null}
                        emptyMessage="No footprint yet"
                      />
                    ) : geometry.status === "loading" ? (
                      <div className="flex h-full items-center justify-center text-sm text-slate-400">
                        <div className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-900/85 px-3 py-2">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-violet-400" />
                          Loading footprint…
                        </div>
                      </div>
                    ) : geometry.status === "error" ? (
                      <div className="flex h-full items-center justify-center bg-red-950/40 px-4 text-center text-sm text-red-300">
                        {geometry.message}
                      </div>
                    ) : (
                      <FootprintPreviewCanvas
                        model={
                          geometry.status === "ready" ? geometry.model : null
                        }
                        emptyMessage="No footprint geometry"
                      />
                    )}
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-slate-200 px-4 py-3 dark:border-slate-800">
                    <dt className="text-sm text-slate-500 dark:text-slate-400">
                      Package
                    </dt>
                    <dd className="text-right font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {selectedPackageLabel}
                    </dd>
                    <dt className="text-sm text-slate-500 dark:text-slate-400">
                      Mount
                    </dt>
                    <dd
                      className="text-right font-mono text-xs font-semibold text-slate-800 dark:text-slate-200"
                      data-testid="component-mount-type"
                    >
                      {selectedVariant?.mountType ?? "—"}
                    </dd>
                    <dt className="text-sm text-slate-500 dark:text-slate-400">
                      Pads
                    </dt>
                    <dd
                      className="text-right font-mono text-xs font-semibold text-slate-800 dark:text-slate-200"
                      data-testid="component-pad-count"
                    >
                      {selectedVariant?.padCount ?? 0}
                    </dd>
                  </dl>
                </section>

                <section
                  className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                  data-testid="library-component-3d-card"
                >
                  <header className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
                    <span className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      3D model
                    </span>
                    <div className="flex items-center gap-2">
                      {hasOptions && selectedVariant ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-violet-600 dark:border-violet-800/50 dark:bg-violet-950/40 dark:text-violet-300">
                          <RefreshCw className="h-3 w-3" />
                          {selectedVariant.variantLabel}
                        </span>
                      ) : null}
                      {canUploadStep ? (
                        <label className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-2.5 text-xs font-medium text-violet-700 transition-colors hover:bg-violet-50 dark:border-violet-700 dark:bg-slate-800 dark:text-violet-300 dark:hover:bg-slate-700">
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
                    </div>
                  </header>
                  {uploadStatus !== "idle" ? (
                    <span
                      className="px-4 pt-2 text-xs text-slate-500 dark:text-slate-400"
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
                      className="mx-4 mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                      data-testid="library-3d-upload-error"
                    >
                      {uploadError}
                    </div>
                  ) : null}
                  <div className="flex min-h-[300px] flex-1 flex-col">
                    {isPlaceholderFootprint ? (
                      <div className="flex h-full min-h-[300px] items-center justify-center bg-slate-950 px-4 text-center text-xs text-slate-400">
                        Add a footprint to enable 3D preview.
                      </div>
                    ) : (
                      <ThreeDComponentPreview
                        key={`${effectiveSelectedId}:${modelRefreshToken}:${externalModelRefreshToken}`}
                        backendURL={backendURL}
                        moduleId={moduleId}
                        footprintId={effectiveSelectedId}
                        category={componentCategory}
                        mountType={selectedVariant?.mountType ?? null}
                        isBuiltin={isBuiltin}
                      />
                    )}
                  </div>
                  <p className="flex items-center justify-center gap-1.5 border-t border-slate-200 px-4 py-2.5 text-[11px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
                    <RefreshCw className="h-3 w-3" />
                    Drag to rotate · scroll to zoom
                  </p>
                </section>
              </div>

              {/* ROW 3: Pins (full width) */}
              <PinsTable
                pinMap={selectedVariant?.pinMap ?? null}
                electricalTypeByPin={electricalTypeByPin}
                packageLabel={selectedPackageLabel}
              />

              {fullscreen === "symbol" ? (
                <PreviewModal
                  title={`${detail.symbol.name} — Symbol`}
                  onClose={() => setFullscreen(null)}
                >
                  <SymbolPreviewCanvas
                    model={symbolPreview}
                    emptyMessage="No symbol preview"
                  />
                </PreviewModal>
              ) : null}

              {fullscreen === "footprint" ? (
                <PreviewModal
                  title={`${selectedVariant?.name ?? detail.footprint.name} — Footprint`}
                  onClose={() => setFullscreen(null)}
                >
                  <FootprintPreviewCanvas
                    model={geometry.status === "ready" ? geometry.model : null}
                    emptyMessage="No footprint geometry"
                  />
                </PreviewModal>
              ) : null}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
