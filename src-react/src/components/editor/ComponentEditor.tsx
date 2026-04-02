import { ArrowLeft, Loader2, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "@/lib/api/component-api";
import {
  useComponentDetail,
  useComponentMutations,
} from "@/hooks/useComponents";
import { useNavigationStore } from "@/stores/navigation-store";

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

export function ComponentEditor({ componentId }: ComponentEditorProps) {
  const navigateToLibrary = useNavigationStore((state) => state.navigateToLibrary);
  const { createComponent, creating, error: createError, clearError: clearCreateError } =
    useComponentMutations();
  const {
    component,
    loading,
    error,
    mutationError,
    saving,
    updateComponent,
    clearMutationError,
  } = useComponentDetail(componentId ?? null);
  const [formState, setFormState] = useState<ComponentEditorFormState>(EMPTY_FORM_STATE);

  useEffect(() => {
    setFormState(toFormState(component));
  }, [component]);

  const isCreating = !componentId;
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

  const handleSave = async () => {
    const displayLabel = formState.displayLabel.trim();
    if (!displayLabel) {
      return;
    }

    clearCreateError();
    clearMutationError();

    const payload = {
      displayLabel,
      description: formState.description.trim(),
      categoryPath: formState.categoryPath.trim() || null,
      tags: parsedTags,
    };

    try {
      if (isCreating) {
        await createComponent({
          canonicalKey: createCanonicalKey(displayLabel),
          ...payload,
        });
      } else {
        await updateComponent(payload);
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
              {isCreating ? "New Component" : formState.displayLabel || "Edit Component"}
            </h1>
            <p className="text-sm text-text-secondary">
              Edit canonical component metadata and save directly to the library.
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
            disabled={isSubmitting || formState.displayLabel.trim().length === 0}
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

        <section className="rounded-lg border border-border-default bg-bg-elevated">
          <div className="border-b border-border-default px-5 py-4">
            <h2 className="text-sm font-medium text-text-primary">Component Metadata</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Core library fields used by search, organization, and future editor integrations.
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
                onChange={(event) => handleFieldChange("displayLabel", event.target.value)}
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
                onChange={(event) => handleFieldChange("description", event.target.value)}
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
                onChange={(event) => handleFieldChange("categoryPath", event.target.value)}
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
                onChange={(event) => handleFieldChange("tags", event.target.value)}
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
                Symbol editing will attach here in the next task.
              </p>
            </div>
            <span className="rounded-full bg-bg-input px-2.5 py-1 text-xs text-text-tertiary">
              Placeholder
            </span>
          </div>
          {/* TODO(task-7): integrate the canonical symbol editor here. */}
          <div
            data-testid="symbol-placeholder"
            className="mt-4 rounded-md border border-dashed border-border-default bg-bg-secondary px-4 py-8 text-sm text-text-tertiary"
          >
            Symbol editor placeholder.
          </div>
        </section>

        <section className="rounded-lg border border-border-default bg-bg-elevated p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium text-text-primary">Footprints / Variants</h2>
              <p className="mt-1 text-sm text-text-secondary">
                Footprint and variant editing will attach here in the next task.
              </p>
            </div>
            <span className="rounded-full bg-bg-input px-2.5 py-1 text-xs text-text-tertiary">
              Placeholder
            </span>
          </div>
          {/* TODO(task-8): integrate the canonical footprint and variant editors here. */}
          <div
            data-testid="footprints-placeholder"
            className="mt-4 rounded-md border border-dashed border-border-default bg-bg-secondary px-4 py-8 text-sm text-text-tertiary"
          >
            Footprints and variants placeholder.
          </div>
        </section>
      </div>
    </div>
  );
}
