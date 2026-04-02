import {
  ArrowLeft,
  Edit,
  Download,
  Copy,
  Trash2,
  FileText,
  Plus,
  X,
  Check,
  AlertTriangle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useComponentDetail } from "@/hooks/useComponents";
import { useNavigationStore } from "../../stores/navigation-store";
import { SymbolPreview } from "./SymbolPreview";
import { FootprintPreview } from "./FootprintPreview";
import { Model3dPlaceholder } from "./Model3dPlaceholder";
import { PinTable } from "./PinTable";

export function ComponentDetailPage() {
  const navigateBack = useNavigationStore((state) => state.navigateBack);
  const currentComponentId = useNavigationStore((state) => state.currentComponentId);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(null);
  const [selectedFootprintId, setSelectedFootprintId] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editForm, setEditForm] = useState({
    displayLabel: "",
    description: "",
    categoryPath: "",
  });
  const {
    component,
    loading,
    error,
    mutationError,
    saving,
    deleting,
    clearMutationError,
    updateComponent,
    deleteComponent,
  } = useComponentDetail(currentComponentId);

  useEffect(() => {
    if (!currentComponentId) {
      navigateBack();
    }
  }, [currentComponentId, navigateBack]);

  useEffect(() => {
    if (!component) {
      setSelectedVariantId(null);
      setSelectedFootprintId(null);
      return;
    }

    const selectedVariant =
      component.packageVariants.find((variant) => variant.id === selectedVariantId) ??
      component.packageVariants.find(
        (variant) => variant.id === component.defaultPackageVariantId,
      ) ??
      component.packageVariants[0] ??
      null;

    if (!selectedVariant) {
      setSelectedVariantId(null);
      setSelectedFootprintId(null);
      return;
    }

    setSelectedVariantId(selectedVariant.id);

    const selectedFootprint =
      selectedVariant.footprintOptions.find(
        (footprint) => footprint.id === selectedFootprintId,
      ) ??
      selectedVariant.footprintOptions.find((footprint) => footprint.isDefault) ??
      selectedVariant.footprintOptions[0] ??
      null;

    setSelectedFootprintId(selectedFootprint?.id ?? null);
  }, [component, selectedVariantId, selectedFootprintId]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg-secondary">
        <div className="text-text-secondary">Loading component...</div>
      </div>
    );
  }

  if (error || !component) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg-secondary">
        <div className="text-center">
          <p className="mb-4 text-error">{error || "Component not found"}</p>
          <button
            type="button"
            onClick={navigateBack}
            className="text-brand hover:underline"
          >
            Back to Library
          </button>
        </div>
      </div>
    );
  }

  const selectedVariant = component.packageVariants.find(
    (variant) => variant.id === selectedVariantId,
  );
  const selectedFootprint = selectedVariant?.footprintOptions?.find(
    (footprint) => footprint.id === selectedFootprintId,
  );
  const hasMultipleVariants = component.packageVariants.length > 1;
  const hasMultipleFootprints = (selectedVariant?.footprintOptions?.length ?? 0) > 1;

  const handleEditClick = () => {
    setEditForm({
      displayLabel: component.displayLabel,
      description: component.description || "",
      categoryPath: component.categoryPath || "",
    });
    clearMutationError();
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    clearMutationError();
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    clearMutationError();

    try {
      await updateComponent({
        displayLabel: editForm.displayLabel,
        description: editForm.description,
        categoryPath: editForm.categoryPath,
      });
      setIsEditing(false);
    } catch {
      return;
    }
  };

  const handleDeleteClick = () => {
    clearMutationError();
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    try {
      await deleteComponent();
      setShowDeleteConfirm(false);
      navigateBack();
    } catch {
      return;
    }
  };

  const handleVariantChange = (variantId: string) => {
    setSelectedVariantId(variantId);

    const nextVariant = component.packageVariants.find(
      (variant) => variant.id === variantId,
    );
    const defaultFootprint =
      nextVariant?.footprintOptions.find((footprint) => footprint.isDefault) ??
      nextVariant?.footprintOptions[0] ??
      null;

    setSelectedFootprintId(defaultFootprint?.id ?? null);
  };

  return (
    <div className="flex h-screen flex-col bg-bg-secondary">
      <header className="flex items-center justify-between border-b border-border-default bg-bg-elevated px-6 py-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={navigateBack}
            className="flex items-center gap-2 text-text-secondary transition-colors hover:text-text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="text-sm">Back to Library</span>
          </button>
          <div className="h-6 w-px bg-border-default" />
          <div>
            <h1 className="text-xl font-semibold text-text-primary">
              {component.displayLabel}
            </h1>
            <div className="mt-0.5 flex items-center gap-3 text-sm text-text-secondary">
              {component.description && (
                <span className="max-w-md truncate">{component.description}</span>
              )}
              <span className="text-text-tertiary">|</span>
              <span>{component.symbolData?.pinDefinitions?.length || 0} pins</span>
              {selectedVariant && (
                <>
                  <span className="text-text-tertiary">|</span>
                  <span className="rounded bg-bg-input px-2 py-0.5 text-xs uppercase">
                    {selectedVariant.mountType}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isEditing ? (
            <>
              {mutationError && (
                <span className="mr-2 text-sm text-error">{mutationError}</span>
              )}
              <button
                type="button"
                onClick={handleCancelEdit}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary"
              >
                <X className="h-4 w-4" />
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSaveEdit()}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Check className="h-4 w-4" />
                {saving ? "Saving..." : "Save"}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary">
                <Download className="h-4 w-4" />
                Export
              </button>
              <button type="button" className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary">
                <Copy className="h-4 w-4" />
                Duplicate
              </button>
              <button
                type="button"
                onClick={handleEditClick}
                className="flex items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-sm text-white transition-opacity hover:opacity-90"
              >
                <Edit className="h-4 w-4" />
                Edit
              </button>
            </>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-4">
            <section className="overflow-hidden rounded-lg border border-border-default bg-bg-elevated">
              <div className="flex items-center justify-between border-b border-border-default bg-bg-secondary px-4 py-3">
                <h2 className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  <FileText className="h-4 w-4 text-text-tertiary" />
                  Schematic Symbol
                </h2>
                <span className="text-xs text-text-tertiary">
                  Ref: {component.symbolData?.referencePrefix || "U"}
                </span>
              </div>
              <div className="p-4">
                <SymbolPreview symbolData={component.symbolData} />
              </div>
            </section>

            <section className="overflow-hidden rounded-lg border border-border-default bg-bg-elevated">
              <div className="flex items-center justify-between border-b border-border-default bg-bg-secondary px-4 py-3">
                <h2 className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  <svg
                    aria-hidden="true"
                    className="h-4 w-4 text-text-tertiary"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  PCB Footprint
                </h2>
                {hasMultipleFootprints && (
                  <select
                    aria-label="Footprint variant"
                    value={selectedFootprintId || ""}
                    onChange={(event) => setSelectedFootprintId(event.target.value)}
                    className="rounded border border-border-default bg-bg-input px-2 py-1 text-xs text-text-primary"
                  >
                    {selectedVariant?.footprintOptions?.map((footprint) => (
                      <option key={footprint.id} value={footprint.id}>
                        {footprint.label} {footprint.isDefault ? "(default)" : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="p-4">
                {selectedFootprint ? (
                  <FootprintPreview footprint={selectedFootprint} />
                ) : (
                  <div className="py-12 text-center text-text-tertiary">
                    No footprint available
                  </div>
                )}
              </div>
            </section>
          </div>

          <section className="overflow-hidden rounded-lg border border-border-default bg-bg-elevated">
            <div className="border-b border-border-default bg-bg-secondary px-4 py-3">
              <h2 className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <svg
                  aria-hidden="true"
                  className="h-4 w-4 text-text-tertiary"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                </svg>
                3D Model
              </h2>
            </div>
            <div className="p-4">
              <Model3dPlaceholder model3dOptions={selectedFootprint?.model3dOptions} />
            </div>
          </section>
        </div>

        <div className="w-[400px] overflow-y-auto border-l border-border-default bg-bg-elevated">
          {isEditing && (
            <div className="border-b border-border-default bg-brand-bg/30 p-4">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-secondary">
                Edit Component
              </h3>
              <div className="space-y-3">
                <div>
                  <label htmlFor="component-display-label" className="mb-1 block text-xs text-text-tertiary">
                    Display Label
                  </label>
                  <input
                    id="component-display-label"
                    type="text"
                    value={editForm.displayLabel}
                    onChange={(event) =>
                      setEditForm({ ...editForm, displayLabel: event.target.value })
                    }
                    className="w-full rounded-md border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-brand focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="component-description" className="mb-1 block text-xs text-text-tertiary">
                    Description
                  </label>
                  <textarea
                    id="component-description"
                    value={editForm.description}
                    onChange={(event) =>
                      setEditForm({ ...editForm, description: event.target.value })
                    }
                    rows={3}
                    className="w-full resize-none rounded-md border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-brand focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="component-category-path" className="mb-1 block text-xs text-text-tertiary">
                    Category Path
                  </label>
                  <input
                    id="component-category-path"
                    type="text"
                    value={editForm.categoryPath}
                    onChange={(event) =>
                      setEditForm({ ...editForm, categoryPath: event.target.value })
                    }
                    placeholder="e.g., Passive/Resistors"
                    className="w-full rounded-md border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary focus:border-brand focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {hasMultipleVariants && (
            <div className="border-b border-border-default p-4">
              <label htmlFor="component-variant" className="mb-2 block text-xs font-medium uppercase tracking-wide text-text-secondary">
                Package Variant
              </label>
              <select
                id="component-variant"
                value={selectedVariantId || ""}
                onChange={(event) => handleVariantChange(event.target.value)}
                className="w-full rounded-md border border-border-default bg-bg-input px-3 py-2 text-sm text-text-primary"
              >
                {component.packageVariants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.humanLabel} {variant.id === component.defaultPackageVariantId ? "(default)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="border-b border-border-default p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-secondary">
              Technical Specifications
            </h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-text-tertiary">Reference Prefix</dt>
                <dd className="font-medium text-text-primary">
                  {component.symbolData?.referencePrefix || "U"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-tertiary">Package</dt>
                <dd className="text-text-primary">
                  {selectedVariant?.canonicalCode || "—"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-tertiary">Mount Type</dt>
                <dd className="capitalize text-text-primary">
                  {selectedVariant?.mountType || "—"}
                </dd>
              </div>
              {selectedVariant?.dimensions && (
                <>
                  <div className="flex justify-between">
                    <dt className="text-text-tertiary">Body Size</dt>
                    <dd className="text-text-primary">
                      {selectedVariant.dimensions.lengthMm} × {selectedVariant.dimensions.widthMm} mm
                    </dd>
                  </div>
                  {selectedVariant.dimensions.heightMm && (
                    <div className="flex justify-between">
                      <dt className="text-text-tertiary">Height</dt>
                      <dd className="text-text-primary">
                        {selectedVariant.dimensions.heightMm} mm
                      </dd>
                    </div>
                  )}
                </>
              )}
              <div className="flex justify-between">
                <dt className="text-text-tertiary">Pin Count</dt>
                <dd className="text-text-primary">
                  {component.symbolData?.pinDefinitions?.length || 0}
                </dd>
              </div>
              {selectedVariant?.imperialAlias && (
                <div className="flex justify-between">
                  <dt className="text-text-tertiary">Imperial Code</dt>
                  <dd className="text-text-primary">{selectedVariant.imperialAlias}</dd>
                </div>
              )}
            </dl>
          </div>

          <div className="border-b border-border-default p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-secondary">
              Pin Assignments
            </h3>
            <PinTable pins={component.symbolData?.pinDefinitions} />
          </div>

          <div className="p-4">
            <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-text-secondary">
              Actions
            </h3>
            <div className="space-y-2">
              <button type="button" className="flex w-full items-center justify-center gap-2 rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90">
                <Plus className="h-4 w-4" />
                Use in Design
              </button>
              <button type="button" className="flex w-full items-center justify-center gap-2 rounded-md border border-border-default px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-bg-hover">
                <Download className="h-4 w-4" />
                Export KiCAD Files
              </button>
              <div className="flex gap-2">
                <button type="button" className="flex flex-1 items-center justify-center gap-2 rounded-md border border-border-default px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-bg-hover">
                  <Copy className="h-4 w-4" />
                  Duplicate
                </button>
                <button
                  type="button"
                  onClick={handleDeleteClick}
                  disabled={deleting}
                  className="flex flex-1 items-center justify-center gap-2 rounded-md border border-error px-4 py-2 text-sm text-error transition-colors hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                  {deleting ? "Deleting..." : "Delete"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-lg border border-border-default bg-bg-elevated p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-error/10">
                <AlertTriangle className="h-5 w-5 text-error" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-text-primary">
                  Delete Component
                </h3>
                <p className="text-sm text-text-secondary">
                  Are you sure you want to delete this component?
                </p>
              </div>
            </div>
            <p className="mb-4 text-sm text-text-secondary">
              This will permanently remove {" "}
              <span className="font-medium text-text-primary">
                {component.displayLabel}
              </span>{" "}
              from your library. This action cannot be undone.
            </p>
            {mutationError && (
              <p className="mb-4 text-sm text-error">{mutationError}</p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleting}
                className="px-4 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                disabled={deleting}
                className="rounded-md bg-error px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete Component"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
