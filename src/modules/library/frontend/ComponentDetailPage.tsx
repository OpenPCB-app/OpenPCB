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
import { Button } from "@shared/frontend/ui";
import type { LibraryComponent } from "../../../sdks/library";
import { useTheme } from "../../../core/frontend/src/providers/ThemeProvider";
import { TagTokenInput } from "./components/TagTokenInput";
import { DetailsCard } from "./components/DetailsCard";
import { FootprintOptionsList } from "./components/FootprintOptionsList";
import { PinsTable } from "./components/PinsTable";
import { PreviewModal } from "./components/PreviewModal";
import { ChangeFootprintDialog } from "./ChangeFootprintDialog";
import { useLibraryTags } from "./hooks/useLibraryTags";
import { useFootprintGeometry } from "./hooks/useFootprintGeometry";
import { useComponentDetail } from "./hooks/useComponentDetail";
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
  refreshToken = 0,
}: {
  backendURL: string | null | undefined;
  moduleId: string;
  componentId: string;
  onBack: () => void;
  onCloned?: (newComponentId: string) => void;
  onUpdated?: (component: LibraryComponent) => void;
  modelRefreshToken?: number;
  refreshToken?: number;
}): ReactElement {
  const { mode: themeMode } = useTheme();
  const [changeFootprintOpen, setChangeFootprintOpen] = useState(false);
  const [footprintRefresh, setFootprintRefresh] = useState(0);
  const {
    detail,
    loading,
    error: loadError,
    setDetail,
  } = useComponentDetail({
    backendURL,
    moduleId,
    componentId,
    refreshToken: refreshToken + footprintRefresh,
  });
  /** Errors raised by page actions (clone), kept separate from the load error. */
  const [actionError, setActionError] = useState<string | null>(null);
  const error = loadError ?? actionError;
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
    refreshToken: tagsRefreshToken + refreshToken,
  });

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
    setActionError(null);
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
      setActionError(
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
    <div className="flex h-full w-full flex-col bg-surface-app">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-surface-rail px-3 py-2">
        <Button type="button" onClick={onBack} icon={<ArrowLeft className="h-3 w-3" />}>
          Back
        </Button>
        <h1 className="text-base font-medium text-text-strong">
          {loading
            ? "Loading component..."
            : (detail?.component.name ?? "Component")}
        </h1>
        {detail && isBuiltin && (
          <span className="inline-flex items-center gap-1 bg-surface-control px-1.5 text-2xs uppercase tracking-[.06em] text-text-strong">
            <Lock className="h-2.5 w-2.5" />
            Core
          </span>
        )}
        {detail && (
          <div className="ml-auto flex items-center gap-2">
            <Button
              type="button"
              disabled
              title="Open a design to place"
              icon={<Plus className="h-3 w-3" />}
            >
              Place in design
            </Button>

            <Button
              type="button"
              variant={isPlaceholderFootprint ? "primary" : "secondary"}
              onClick={() => setChangeFootprintOpen(true)}
              disabled={!backendURL}
              data-testid="component-change-footprint-button"
              className="cursor-pointer"
            >
              {isPlaceholderFootprint ? "Add footprint" : "Change footprint"}
            </Button>

            {isBuiltin ? (
              <Button
                type="button"
                variant="primary"
                onClick={() => void handleClone()}
                disabled={cloning || !backendURL}
                icon={<Copy className="h-3 w-3" />}
              >
                {cloning ? "Duplicating..." : "Duplicate to edit"}
              </Button>
            ) : editing ? (
              <>
                <Button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  icon={<X className="h-3 w-3" />}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => void handleSave()}
                  disabled={saving || !backendURL}
                  icon={<Save className="h-3 w-3" />}
                  data-testid="component-save-button"
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
              </>
            ) : (
              <Button
                type="button"
                variant="primary"
                onClick={beginEdit}
                disabled={!backendURL}
                icon={<Pencil className="h-3 w-3" />}
                data-testid="component-edit-button"
              >
                Edit
              </Button>
            )}
          </div>
        )}
      </header>

      <main className="flex-1 overflow-auto">
        <div className="mx-auto w-full max-w-[1380px] px-6 py-6">
          {loading && (
            <div className="rounded-control border border-border bg-surface-panel px-4 py-10 text-center text-xs text-text-tertiary">
              Loading component detail...
            </div>
          )}

          {!loading && error && (
            <div className="rounded-control border border-status-danger px-4 py-4 text-xs text-status-danger">
              {error}
            </div>
          )}

          {!loading && !error && detail && (
            <div className="space-y-[18px]">
              {isBuiltin && (
                <p className="flex items-center gap-2 text-xs text-text-tertiary">
                  <Lock className="h-3 w-3 text-text-disabled" />
                  <span>
                    <span className="font-medium text-text-strong">
                      Read-only built-in.
                    </span>{" "}
                    Duplicate to make an editable copy. Placing is allowed.
                  </span>
                </p>
              )}

              {editing ? (
                <div className="rounded-control border border-border bg-surface-panel p-4">
                  <div className="space-y-3">
                    <div>
                      <label
                        htmlFor="component-edit-name"
                        className="block text-2xs uppercase tracking-[.04em] text-text-caps"
                      >
                        Name
                      </label>
                      <input
                        id="component-edit-name"
                        type="text"
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        className="mt-1 w-full rounded-control border border-border-control bg-surface-input px-2 py-1 text-xs text-text-strong outline-none focus:border-selection"
                        maxLength={200}
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="component-edit-description"
                        className="block text-2xs uppercase tracking-[.04em] text-text-caps"
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
                        className="mt-1 w-full rounded-control border border-border-control bg-surface-input px-2 py-1 text-xs text-text-strong outline-none focus:border-selection"
                        maxLength={2000}
                      />
                    </div>
                    <div>
                      <span className="block text-2xs uppercase tracking-[.04em] text-text-caps">
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
                      <div className="rounded-control border border-status-danger px-2 py-1.5 text-2xs text-status-danger">
                        {saveError}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div>
                  <h2 className="text-xl font-medium tracking-tight text-text-strong">
                    {detail.component.name}
                  </h2>
                  {detail.component.description ? (
                    <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-text-tertiary">
                      {detail.component.description}
                    </p>
                  ) : null}
                  <div className="mt-3.5 flex flex-wrap items-center gap-2">
                    {tagSplit.semantic.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex h-[18px] items-center rounded-control border border-border-control px-1.5 text-2xs text-text"
                      >
                        {tag}
                      </span>
                    ))}
                    {tagSplit.provenance.map((chip) => (
                      <span
                        key={chip.tag}
                        className="ml-auto inline-flex h-[18px] items-center gap-1.5 rounded-control border border-dashed border-border-control px-1.5 text-2xs text-text-tertiary"
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
                  datasheetUrl={detail.component.datasheetUrl ?? null}
                />

                <section className="flex h-full flex-col overflow-hidden rounded-control border border-border bg-surface-panel">
                  <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                    <span className="font-mono text-2xs uppercase tracking-[.04em] text-text-tertiary">
                      Symbol
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-[18px] items-center rounded-control border border-border-control px-1.5 font-mono text-2xs text-text-tertiary">
                        shared across options
                      </span>
                      <button
                        type="button"
                        onClick={() => setFullscreen("symbol")}
                        disabled={!symbolPreview}
                        title="Full screen"
                        aria-label="Open symbol full screen"
                        className="inline-flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-control border border-border-control text-text-secondary outline-none transition-colors hover:bg-surface-hover hover:text-text-strong disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Maximize2 className="h-3 w-3" />
                      </button>
                    </div>
                  </header>
                  <div className="min-h-[320px] flex-1 overflow-hidden bg-surface-canvas-well">
                    <SymbolPreviewCanvas
                      model={symbolPreview}
                      emptyMessage="No symbol preview"
                    />
                  </div>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-border px-3 py-2">
                    <dt className="text-xs text-text-tertiary">
                      Reference prefix
                    </dt>
                    <dd className="text-right font-mono text-2xs text-text-strong">
                      {detail.symbol.referencePrefix || "—"}
                    </dd>
                    <dt className="text-xs text-text-tertiary">Pins</dt>
                    <dd className="text-right font-mono text-2xs text-text-strong">
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

                <section className="flex h-full flex-col overflow-hidden rounded-control border border-border bg-surface-panel">
                  <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                    <span className="font-mono text-2xs uppercase tracking-[.04em] text-text-tertiary">
                      Footprint
                    </span>
                    <div className="flex items-center gap-2">
                      {hasOptions && selectedVariant ? (
                        <span className="inline-flex h-[18px] items-center gap-1.5 rounded-control border border-border-control px-1.5 font-mono text-2xs text-text-secondary">
                          <RefreshCw className="h-2.5 w-2.5" />
                          {selectedVariant.variantLabel}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setFullscreen("footprint")}
                        disabled={geometry.status !== "ready"}
                        title="Full screen"
                        aria-label="Open footprint full screen"
                        className="inline-flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-control border border-border-control text-text-secondary outline-none transition-colors hover:bg-surface-hover hover:text-text-strong disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Maximize2 className="h-3 w-3" />
                      </button>
                    </div>
                  </header>
                  <div
                    className="relative min-h-[300px] flex-1 overflow-hidden bg-surface-canvas-well"
                    data-testid="footprint-preview-canvas"
                  >
                    {isPlaceholderFootprint ? (
                      <FootprintPreviewCanvas
                        model={null}
                        emptyMessage="No footprint yet"
                      />
                    ) : geometry.status === "loading" ? (
                      <div className="flex h-full items-center justify-center text-xs text-text-tertiary">
                        Loading footprint…
                      </div>
                    ) : geometry.status === "error" ? (
                      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-status-danger">
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
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 border-t border-border px-3 py-2">
                    <dt className="text-xs text-text-tertiary">Package</dt>
                    <dd className="text-right font-mono text-2xs text-text-strong">
                      {selectedPackageLabel}
                    </dd>
                    <dt className="text-xs text-text-tertiary">Mount</dt>
                    <dd
                      className="text-right font-mono text-2xs text-text-strong"
                      data-testid="component-mount-type"
                    >
                      {selectedVariant?.mountType ?? "—"}
                    </dd>
                    <dt className="text-xs text-text-tertiary">Pads</dt>
                    <dd
                      className="text-right font-mono text-2xs text-text-strong"
                      data-testid="component-pad-count"
                    >
                      {selectedVariant?.padCount ?? 0}
                    </dd>
                  </dl>
                </section>

                <section
                  className="flex h-full flex-col overflow-hidden rounded-control border border-border bg-surface-panel"
                  data-testid="library-component-3d-card"
                >
                  <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                    <span className="font-mono text-2xs uppercase tracking-[.04em] text-text-tertiary">
                      3D model
                    </span>
                    <div className="flex items-center gap-2">
                      {hasOptions && selectedVariant ? (
                        <span className="inline-flex h-[18px] items-center gap-1.5 rounded-control border border-border-control px-1.5 font-mono text-2xs text-text-secondary">
                          <RefreshCw className="h-2.5 w-2.5" />
                          {selectedVariant.variantLabel}
                        </span>
                      ) : null}
                      {canUploadStep ? (
                        <label className="inline-flex h-[22px] cursor-pointer items-center gap-1.5 rounded-control border border-border-control px-2 text-xs text-text transition-colors hover:bg-surface-hover hover:text-text-strong">
                          <Upload className="h-3 w-3" />
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
                      className="px-3 pt-2 text-2xs text-text-tertiary"
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
                      className="mx-3 mt-2 rounded-control border border-status-danger px-2 py-1.5 text-2xs text-status-danger"
                      data-testid="library-3d-upload-error"
                    >
                      {uploadError}
                    </div>
                  ) : null}
                  <div className="flex min-h-[300px] flex-1 flex-col">
                    {isPlaceholderFootprint ? (
                      <div className="flex h-full min-h-[300px] items-center justify-center bg-surface-canvas-well px-4 text-center text-2xs text-text-tertiary">
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
                  <p className="flex items-center justify-center gap-1.5 border-t border-border px-3 py-2 text-2xs text-text-tertiary">
                    <RefreshCw className="h-2.5 w-2.5" />
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
      {changeFootprintOpen ? (
        <ChangeFootprintDialog
          backendURL={backendURL}
          moduleId={moduleId}
          componentId={componentId}
          symbolPinNumbers={(symbolPreview?.pins ?? []).flatMap((pin) =>
            pin.number ? [pin.number] : [],
          )}
          onCancel={() => setChangeFootprintOpen(false)}
          onCloned={onCloned}
          onDone={() => {
            setChangeFootprintOpen(false);
            setFootprintRefresh((tick) => tick + 1);
            setModelRefreshToken((tick) => tick + 1);
          }}
        />
      ) : null}
    </div>
  );
}
