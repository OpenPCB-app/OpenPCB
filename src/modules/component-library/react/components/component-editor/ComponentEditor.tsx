import { ArrowLeft, Loader2, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addComponentVariant,
  removeComponentVariant,
  setDefaultComponentVariant,
  updateComponentVariant,
  type ComponentType,
} from "@/lib/api/component-api";
import {
  useComponentDetail,
  useComponentMutations,
  useComponents,
} from "@/hooks/useComponents";
import {
  PinPalette,
  PinPropertiesPanel,
  SymbolEditorCanvas,
  SymbolEditorToolbar,
  SymbolMetadataEditor,
  useIsDirty as useSymbolEditorIsDirty,
  useSymbolEditorStore,
} from "@/components/symbol-editor";
import {
  type FootprintDraft,
  useFootprintEditorStore,
  useIsDirty as useFootprintEditorIsDirty,
} from "@/components/footprint-editor";
import { useNavigationStore } from "@/stores/navigation-store";
import { useSchematicStore } from "@/stores/schematic-store";
import { toast } from "@/components/ui/use-toast";
import { ComponentVariantManager } from "./ComponentVariantManager";
import {
  createFootprintDraftFromVariant,
  createInitialEditableVariants,
  createNewEditableVariant,
  getDefaultVariantId,
  normalizeEditableVariants,
  serializeFootprintDraft,
  toComponentVariantPayload,
  toVariantMutationPayload,
  type EditableComponentVariant,
} from "./component-variant-buffer";
import {
  loadSymbolDraftFromComponent,
  transformSymbolDraftToComponentSymbolData,
} from "./symbol-data-buffer";

interface ComponentEditorProps {
  componentId?: string;
}

interface ComponentEditorFormState {
  displayLabel: string;
  description: string;
  categoryPath: string;
  tags: string;
}

const EMPTY_FORM_STATE: ComponentEditorFormState = {
  displayLabel: "",
  description: "",
  categoryPath: "",
  tags: "",
};

function toFormState(
  component?: ComponentType | null,
): ComponentEditorFormState {
  if (!component) {
    return EMPTY_FORM_STATE;
  }

  return {
    displayLabel: component.displayLabel,
    description: component.description,
    categoryPath: component.categoryPath ?? "",
    tags: component.tags.join(", "),
  };
}

function createCanonicalKey(displayLabel: string): string {
  const slug = displayLabel
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix =
    globalThis.crypto?.randomUUID?.().slice(0, 8) ?? Date.now().toString(36);

  return slug ? `${slug}-${suffix}` : `component-${suffix}`;
}

function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

function getServerVariants(
  component: ComponentType,
): ComponentType["variants"] {
  return component.variants;
}

function ComponentSymbolEditor() {
  const selection = useSymbolEditorStore((state) => state.chrome.selection);
  const hasSelection = selection.selectedPinIds.size > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <SymbolEditorToolbar />
      <div className="flex flex-1 overflow-hidden">
        <div className="w-56 flex-shrink-0 space-y-4 overflow-y-auto border-r border-border-default bg-bg-secondary p-3">
          <PinPalette />
        </div>

        <div className="flex-1 overflow-hidden">
          <SymbolEditorCanvas />
        </div>

        <div className="w-64 flex-shrink-0 space-y-4 overflow-y-auto border-l border-border-default bg-bg-secondary p-3">
          <SymbolMetadataEditor />
          <div className="border-t border-border-default pt-4">
            {hasSelection ? (
              <PinPropertiesPanel />
            ) : (
              <div className="text-sm text-text-muted">
                <p className="mb-2 font-medium text-text-secondary">
                  Pin Properties
                </p>
                <p className="text-xs italic">
                  Select a pin to edit its properties
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ComponentEditor({ componentId }: ComponentEditorProps) {
  const navigateToLibrary = useNavigationStore(
    (state) => state.navigateToLibrary,
  );
  const { refetchAndPropagate } = useComponents();
  const {
    createComponent,
    creating,
    error: createError,
    clearError: clearCreateError,
  } = useComponentMutations();
  const {
    component,
    loading,
    error,
    mutationError,
    saving,
    updateComponent,
    clearMutationError,
  } = useComponentDetail(componentId ?? null);
  const [formState, setFormState] =
    useState<ComponentEditorFormState>(EMPTY_FORM_STATE);
  const [symbolWarning, setSymbolWarning] = useState<string | null>(null);
  const [symbolLoading, setSymbolLoading] = useState(false);
  const symbolDraft = useSymbolEditorStore((state) => state.draft);
  const setSymbolDraft = useSymbolEditorStore((state) => state.setDraft);
  const resetSymbolDraft = useSymbolEditorStore((state) => state.resetDraft);
  const symbolIsDirty = useSymbolEditorIsDirty();
  const footprintDraft = useFootprintEditorStore((state) => state.draft);
  const setFootprintDraft = useFootprintEditorStore((state) => state.setDraft);
  const resetFootprintDraft = useFootprintEditorStore(
    (state) => state.resetDraft,
  );
  const footprintIsDirty = useFootprintEditorIsDirty();
  const [variants, setVariants] = useState<EditableComponentVariant[]>([
    createNewEditableVariant([]),
  ]);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    null,
  );
  const [variantsDirty, setVariantsDirty] = useState(false);
  const suppressFootprintSyncRef = useRef(false);
  const isCreating = !componentId;

  const loadVariantFootprint = useCallback(
    (variant: EditableComponentVariant) => {
      suppressFootprintSyncRef.current = true;
      setFootprintDraft(createFootprintDraftFromVariant(variant));
    },
    [setFootprintDraft],
  );

  useEffect(() => {
    setFormState(toFormState(component));
  }, [component]);

  useEffect(() => {
    const initialVariants = createInitialEditableVariants(component);
    const defaultVariantId = getDefaultVariantId(initialVariants);
    const selectedId =
      defaultVariantId ??
      initialVariants[0]?.id ??
      createNewEditableVariant([]).id;

    setVariants(initialVariants);
    setSelectedVariantId(selectedId);
    setVariantsDirty(false);

    const selectedVariant =
      initialVariants.find((variant) => variant.id === selectedId) ??
      initialVariants[0] ??
      null;

    if (selectedVariant) {
      loadVariantFootprint(selectedVariant);
      return;
    }

    resetFootprintDraft(componentId);
  }, [component, componentId, loadVariantFootprint, resetFootprintDraft]);

  useEffect(() => {
    let cancelled = false;

    const initializeSymbolState = async () => {
      setSymbolWarning(null);

      if (isCreating) {
        resetSymbolDraft(componentId);
        return;
      }

      if (!component) {
        return;
      }

      setSymbolLoading(true);

      try {
        const { draft, warning } =
          await loadSymbolDraftFromComponent(component);
        if (cancelled) {
          return;
        }
        setSymbolDraft(draft);
        setSymbolWarning(warning);
      } finally {
        if (!cancelled) {
          setSymbolLoading(false);
        }
      }
    };

    void initializeSymbolState();

    return () => {
      cancelled = true;
    };
  }, [component, componentId, isCreating, resetSymbolDraft, setSymbolDraft]);

  useEffect(() => {
    if (!selectedVariantId) {
      return;
    }
    if (suppressFootprintSyncRef.current) {
      suppressFootprintSyncRef.current = false;
      return;
    }

    setVariants((current) =>
      current.map((variant) =>
        variant.id === selectedVariantId
          ? {
              ...variant,
              footprintPayload: serializeFootprintDraft(footprintDraft),
            }
          : variant,
      ),
    );
    setVariantsDirty(true);
  }, [footprintDraft, selectedVariantId]);

  const isSubmitting = creating || saving;
  const saveError = createError ?? mutationError;
  const parsedTags = useMemo(() => parseTags(formState.tags), [formState.tags]);

  const handleFieldChange = <T extends keyof ComponentEditorFormState>(
    field: T,
    value: ComponentEditorFormState[T],
  ) => {
    setFormState((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleCancel = () => {
    clearCreateError();
    clearMutationError();
    navigateToLibrary();
  };

  const handleSelectVariant = useCallback(
    (variantId: string) => {
      setSelectedVariantId(variantId);
      const variant = variants.find((candidate) => candidate.id === variantId);
      if (variant) {
        loadVariantFootprint(variant);
      }
    },
    [variants, loadVariantFootprint],
  );

  const handleAddVariant = useCallback(() => {
    const newVariant = createNewEditableVariant(variants);
    setVariants((current) => [...current, newVariant]);
    setSelectedVariantId(newVariant.id);
    loadVariantFootprint(newVariant);
    setVariantsDirty(true);
  }, [variants, loadVariantFootprint]);

  const handleRemoveVariant = useCallback(
    (variantId: string) => {
      setVariants((current) => {
        const filtered = current.filter((variant) => variant.id !== variantId);
        const normalized = normalizeEditableVariants(filtered);
        const nextSelectedVariantId =
          selectedVariantId === variantId
            ? getDefaultVariantId(normalized)
            : selectedVariantId;

        if (nextSelectedVariantId !== selectedVariantId) {
          const nextVariant = normalized.find(
            (variant) => variant.id === nextSelectedVariantId,
          );
          if (nextVariant) {
            loadVariantFootprint(nextVariant);
          }
        }

        setSelectedVariantId(nextSelectedVariantId);
        return normalized;
      });
      setVariantsDirty(true);
    },
    [selectedVariantId, loadVariantFootprint],
  );

  const handleSetDefaultVariant = useCallback((variantId: string) => {
    setVariants((current) =>
      current.map((variant) => ({
        ...variant,
        isDefault: variant.id === variantId,
      })),
    );
    setVariantsDirty(true);
  }, []);

  const handleUpdateVariant = useCallback(
    (
      variantId: string,
      updates: Partial<
        Pick<EditableComponentVariant, "humanLabel" | "mountType">
      >,
    ) => {
      setVariants((current) =>
        current.map((variant) =>
          variant.id === variantId ? { ...variant, ...updates } : variant,
        ),
      );
      setVariantsDirty(true);
    },
    [],
  );

  const handleImportedDraft = useCallback(
    (draft: FootprintDraft) => {
      setFootprintDraft(draft);
    },
    [setFootprintDraft],
  );

  const handleSave = async () => {
    const displayLabel = formState.displayLabel.trim();
    if (!displayLabel) {
      return;
    }

    clearCreateError();
    clearMutationError();

    const symbolData = transformSymbolDraftToComponentSymbolData(
      symbolDraft,
      component?.symbolData,
    );

    const normalizedVariants = normalizeEditableVariants(variants);

    const payload = {
      displayLabel,
      description: formState.description.trim(),
      categoryPath: formState.categoryPath.trim() || null,
      tags: parsedTags,
      symbolData,
    };

    try {
      if (isCreating) {
        await createComponent({
          canonicalKey: createCanonicalKey(displayLabel),
          ...payload,
          variants: normalizedVariants.map((variant) =>
            toComponentVariantPayload(variant, "temp"),
          ),
        });
      } else {
        await updateComponent(payload);

        if (component?.id && (variantsDirty || footprintIsDirty)) {
          const serverVariants = getServerVariants(component);
          const localVariantById = new Map(
            normalizedVariants.map((variant) => [variant.id, variant]),
          );
          const localToServerVariantId = new Map<string, string>();

          await Promise.all(
            serverVariants
              .filter((variant) => !localVariantById.has(variant.id))
              .map((variant) =>
                removeComponentVariant(component.id, variant.id),
              ),
          );

          const serverVariantIds = new Set(
            serverVariants.map((variant) => variant.id),
          );
          for (const variant of normalizedVariants) {
            if (serverVariantIds.has(variant.id)) {
              await updateComponentVariant(
                component.id,
                variant.id,
                toVariantMutationPayload(variant),
              );
              localToServerVariantId.set(variant.id, variant.id);
              continue;
            }

            const createdVariant = await addComponentVariant(
              component.id,
              toVariantMutationPayload(variant),
            );
            localToServerVariantId.set(variant.id, createdVariant.id);
          }

          const defaultLocalVariantId =
            getDefaultVariantId(normalizedVariants) ??
            normalizedVariants[0]?.id ??
            null;
          if (defaultLocalVariantId) {
            const defaultServerVariantId =
              localToServerVariantId.get(defaultLocalVariantId) ??
              defaultLocalVariantId;
            await setDefaultComponentVariant(
              component.id,
              defaultServerVariantId,
            );
          }
        }
      }

      await refetchAndPropagate();

      if (!isCreating && component?.id) {
        const persisted = useSchematicStore.getState().persisted;
        const affectedCount =
          persisted.document?.symbols.filter(
            (s) => s.componentId === component.id,
          ).length ?? 0;

        if (affectedCount > 0) {
          toast({
            title: "Component updated",
            description: `${affectedCount} instance${affectedCount === 1 ? "" : "s"} in open designs refreshed.`,
          });
        } else {
          toast({
            title: "Component saved",
            description: "Successfully updated component.",
          });
        }
      } else {
        toast({
          title: "Component created",
          description: "Successfully created new component.",
        });
      }

      navigateToLibrary();
    } catch {
      return;
    }
  };

  if (!isCreating && loading) {
    return (
      <div className="flex h-full items-center justify-center bg-bg-secondary">
        <Loader2 className="h-8 w-8 animate-spin text-text-tertiary" />
      </div>
    );
  }

  if (!isCreating && (error || !component)) {
    return (
      <div className="flex h-full items-center justify-center bg-bg-secondary p-6">
        <div className="rounded-lg border border-border-default bg-bg-elevated p-6 text-center">
          <p className="text-sm text-error">{error || "Component not found"}</p>
          <button
            type="button"
            onClick={handleCancel}
            className="mt-4 text-sm text-brand hover:underline"
          >
            Back to Library
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg-secondary">
      <header className="flex items-center justify-between border-b border-border-default bg-bg-elevated px-6 py-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={handleCancel}
            className="flex items-center gap-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Library
          </button>
          <div className="h-6 w-px bg-border-default" />
          <div>
            <h1 className="text-xl font-semibold text-text-primary">
              {isCreating
                ? "New Component"
                : formState.displayLabel || "Edit Component"}
            </h1>
            <p className="text-sm text-text-secondary">
              Edit canonical component metadata and save directly to the
              library.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-md px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={
              isSubmitting || formState.displayLabel.trim().length === 0
            }
            className="flex items-center gap-2 rounded-md bg-brand px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {isSubmitting
              ? isCreating
                ? "Creating..."
                : "Saving..."
              : isCreating
                ? "Create Component"
                : "Save Component"}
          </button>
        </div>
      </header>

      <div className="mx-auto flex h-full w-full max-w-5xl flex-1 flex-col gap-6 overflow-auto p-6">
        {saveError && (
          <div className="rounded-lg border border-border-default bg-bg-elevated px-4 py-3 text-sm text-error">
            {saveError}
          </div>
        )}

        {symbolWarning && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
            {symbolWarning}
          </div>
        )}

        <section className="rounded-lg border border-border-default bg-bg-elevated">
          <div className="border-b border-border-default px-5 py-4">
            <h2 className="text-sm font-medium text-text-primary">
              Component Metadata
            </h2>
            <p className="mt-1 text-sm text-text-secondary">
              Core library fields used by search, organization, and future
              editor integrations.
            </p>
          </div>

          <div className="grid gap-4 p-5 md:grid-cols-2">
            <div className="md:col-span-2">
              <label
                htmlFor="component-display-label"
                className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-text-secondary"
              >
                Name
              </label>
              <input
                id="component-display-label"
                type="text"
                value={formState.displayLabel}
                onChange={(event) =>
                  handleFieldChange("displayLabel", event.target.value)
                }
                placeholder="Enter component name"
                className="w-full rounded-md border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-brand focus:outline-none"
              />
            </div>

            <div className="md:col-span-2">
              <label
                htmlFor="component-description"
                className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-text-secondary"
              >
                Description
              </label>
              <textarea
                id="component-description"
                rows={4}
                value={formState.description}
                onChange={(event) =>
                  handleFieldChange("description", event.target.value)
                }
                placeholder="Describe this component"
                className="w-full resize-none rounded-md border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-brand focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="component-category-path"
                className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-text-secondary"
              >
                Category Path
              </label>
              <input
                id="component-category-path"
                type="text"
                value={formState.categoryPath}
                onChange={(event) =>
                  handleFieldChange("categoryPath", event.target.value)
                }
                placeholder="e.g. Passives/Resistors"
                className="w-full rounded-md border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-brand focus:outline-none"
              />
            </div>

            <div>
              <label
                htmlFor="component-tags"
                className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-text-secondary"
              >
                Tags
              </label>
              <input
                id="component-tags"
                type="text"
                value={formState.tags}
                onChange={(event) =>
                  handleFieldChange("tags", event.target.value)
                }
                placeholder="comma, separated, tags"
                className="w-full rounded-md border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-brand focus:outline-none"
              />
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-border-default bg-bg-elevated p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium text-text-primary">Symbol</h2>
              <p className="mt-1 text-sm text-text-secondary">
                Edit symbol geometry, metadata, and pin definitions for this
                component.
              </p>
            </div>
            <span
              data-testid="symbol-dirty-indicator"
              className="rounded-full bg-bg-input px-2.5 py-1 text-xs text-text-tertiary"
            >
              {symbolLoading
                ? "Loading…"
                : symbolIsDirty
                  ? "Modified"
                  : "Saved"}
            </span>
          </div>

          <div
            data-testid="component-symbol-editor"
            className="mt-4 h-[640px] overflow-hidden rounded-md border border-border-default"
          >
            <ComponentSymbolEditor />
          </div>
        </section>

        <ComponentVariantManager
          variants={variants}
          selectedVariantId={selectedVariantId}
          variantDirty={variantsDirty || footprintIsDirty}
          onSelectVariant={handleSelectVariant}
          onAddVariant={handleAddVariant}
          onRemoveVariant={handleRemoveVariant}
          onSetDefaultVariant={handleSetDefaultVariant}
          onUpdateVariant={handleUpdateVariant}
          onImportedDraft={handleImportedDraft}
        />
      </div>
    </div>
  );
}
