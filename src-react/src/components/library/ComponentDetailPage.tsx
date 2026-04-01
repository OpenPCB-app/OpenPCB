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
import {
  getComponentFamily,
  updateComponentFamily,
  deleteComponentFamily,
} from "../../lib/api/component-api";
import { useNavigationStore } from "../../stores/navigation-store";
import type { ComponentFamilyType } from "../../../../src-ts/src/core/schemas/component-library.schema";
import { SymbolPreview } from "./SymbolPreview";
import { FootprintPreview } from "./FootprintPreview";
import { Model3dPlaceholder } from "./Model3dPlaceholder";
import { PinTable } from "./PinTable";

export function ComponentDetailPage() {
  const navigateBack = useNavigationStore((s) => s.navigateBack);
  const currentComponentId = useNavigationStore((s) => s.currentComponentId);
  const [component, setComponent] = useState<ComponentFamilyType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    null,
  );
  const [selectedFootprintId, setSelectedFootprintId] = useState<string | null>(
    null,
  );
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editForm, setEditForm] = useState({
    displayLabel: "",
    description: "",
    categoryPath: "",
  });
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentComponentId) {
      navigateBack();
      return;
    }

    const loadComponent = async () => {
      try {
        setLoading(true);
        const data = await getComponentFamily(currentComponentId);
        setComponent(data);
        if (data.packageVariants && data.packageVariants.length > 0) {
          const defaultVariant =
            data.packageVariants.find(
              (v) => v.id === data.defaultPackageVariantId,
            ) || data.packageVariants[0];
          if (defaultVariant) {
            setSelectedVariantId(defaultVariant.id);
            if (
              defaultVariant.footprintOptions &&
              defaultVariant.footprintOptions.length > 0
            ) {
              const defaultFootprint =
                defaultVariant.footprintOptions.find((f) => f.isDefault) ||
                defaultVariant.footprintOptions[0];
              if (defaultFootprint) {
                setSelectedFootprintId(defaultFootprint.id);
              }
            }
          }
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load component",
        );
      } finally {
        setLoading(false);
      }
    };

    loadComponent();
  }, [currentComponentId, navigateBack]);

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
          <p className="text-error mb-4">{error || "Component not found"}</p>
          <button onClick={navigateBack} className="text-brand hover:underline">
            Back to Library
          </button>
        </div>
      </div>
    );
  }

  const selectedVariant = component.packageVariants?.find(
    (v) => v.id === selectedVariantId,
  );
  const selectedFootprint = selectedVariant?.footprintOptions?.find(
    (f) => f.id === selectedFootprintId,
  );
  const hasMultipleVariants = (component.packageVariants?.length || 0) > 1;
  const hasMultipleFootprints =
    (selectedVariant?.footprintOptions?.length || 0) > 1;
  const isWorkspaceComponent = component.scope === "workspace";

  const handleEditClick = () => {
    setEditForm({
      displayLabel: component.displayLabel,
      description: component.description || "",
      categoryPath: component.categoryPath || "",
    });
    setIsEditing(true);
    setSaveError(null);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setSaveError(null);
  };

  const handleSaveEdit = async () => {
    if (!currentComponentId) return;
    setSaveError(null);
    try {
      const updated = await updateComponentFamily(currentComponentId, {
        displayLabel: editForm.displayLabel,
        description: editForm.description,
        categoryPath: editForm.categoryPath,
      });
      setComponent(updated);
      setIsEditing(false);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save changes",
      );
    }
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = async () => {
    if (!currentComponentId) return;
    setIsDeleting(true);
    try {
      await deleteComponentFamily(currentComponentId);
      setShowDeleteConfirm(false);
      navigateBack();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to delete component",
      );
      setIsDeleting(false);
    }
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
  };

  return (
    <div className="flex flex-col h-screen bg-bg-secondary">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-border-default bg-bg-elevated px-6 py-4">
        <div className="flex items-center gap-4">
          <button
            onClick={navigateBack}
            className="flex items-center gap-2 text-text-secondary hover:text-text-primary transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="text-sm">Back to Library</span>
          </button>
          <div className="h-6 w-px bg-border-default" />
          <div>
            <h1 className="text-xl font-semibold text-text-primary">
              {component.displayLabel}
            </h1>
            <div className="flex items-center gap-3 text-sm text-text-secondary mt-0.5">
              {component.description && (
                <span className="truncate max-w-md">
                  {component.description}
                </span>
              )}
              <span className="text-text-tertiary">|</span>
              <span>
                {component.symbolData?.pinDefinitions?.length || 0} pins
              </span>
              {selectedVariant && (
                <>
                  <span className="text-text-tertiary">|</span>
                  <span className="uppercase text-xs bg-bg-input px-2 py-0.5 rounded">
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
              {saveError && (
                <span className="text-sm text-error mr-2">{saveError}</span>
              )}
              <button
                onClick={handleCancelEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors"
              >
                <X className="h-4 w-4" />
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-brand text-white hover:opacity-90 rounded-md transition-opacity"
              >
                <Check className="h-4 w-4" />
                Save
              </button>
            </>
          ) : (
            <>
              <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors">
                <Download className="h-4 w-4" />
                Export
              </button>
              <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-hover rounded-md transition-colors">
                <Copy className="h-4 w-4" />
                Duplicate
              </button>
              {isWorkspaceComponent && (
                <button
                  onClick={handleEditClick}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-brand text-white hover:opacity-90 rounded-md transition-opacity"
                >
                  <Edit className="h-4 w-4" />
                  Edit
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Column - Visual Stack */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            {/* Symbol Preview */}
            <section className="bg-bg-elevated rounded-lg border border-border-default overflow-hidden">
              <div className="px-4 py-3 border-b border-border-default bg-bg-secondary flex items-center justify-between">
                <h2 className="text-sm font-medium text-text-primary flex items-center gap-2">
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

            {/* Footprint Preview */}
            <section className="bg-bg-elevated rounded-lg border border-border-default overflow-hidden">
              <div className="px-4 py-3 border-b border-border-default bg-bg-secondary flex items-center justify-between">
                <h2 className="text-sm font-medium text-text-primary flex items-center gap-2">
                  <svg
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
                    value={selectedFootprintId || ""}
                    onChange={(e) => setSelectedFootprintId(e.target.value)}
                    className="text-xs bg-bg-input border border-border-default rounded px-2 py-1 text-text-primary"
                  >
                    {selectedVariant?.footprintOptions?.map((fp) => (
                      <option key={fp.id} value={fp.id}>
                        {fp.label} {fp.isDefault ? "(default)" : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="p-4">
                {selectedFootprint ? (
                  <FootprintPreview footprint={selectedFootprint} />
                ) : (
                  <div className="text-center py-12 text-text-tertiary">
                    No footprint available
                  </div>
                )}
              </div>
            </section>
          </div>

          {/* 3D Model */}
          <section className="bg-bg-elevated rounded-lg border border-border-default overflow-hidden">
            <div className="px-4 py-3 border-b border-border-default bg-bg-secondary">
              <h2 className="text-sm font-medium text-text-primary flex items-center gap-2">
                <svg
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
              <Model3dPlaceholder
                model3dOptions={selectedFootprint?.model3dOptions}
              />
            </div>
          </section>
        </div>

        {/* Right Column - Specs & Actions */}
        <div className="w-[400px] border-l border-border-default bg-bg-elevated overflow-y-auto">
          {/* Edit Form */}
          {isEditing && (
            <div className="p-4 border-b border-border-default bg-brand-bg/30">
              <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-3">
                Edit Component
              </h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-text-tertiary mb-1">
                    Display Label
                  </label>
                  <input
                    type="text"
                    value={editForm.displayLabel}
                    onChange={(e) =>
                      setEditForm({ ...editForm, displayLabel: e.target.value })
                    }
                    className="w-full bg-bg-input border border-border-default rounded-md px-3 py-2 text-sm text-text-primary focus:border-brand focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-tertiary mb-1">
                    Description
                  </label>
                  <textarea
                    value={editForm.description}
                    onChange={(e) =>
                      setEditForm({ ...editForm, description: e.target.value })
                    }
                    rows={3}
                    className="w-full bg-bg-input border border-border-default rounded-md px-3 py-2 text-sm text-text-primary focus:border-brand focus:outline-none resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-text-tertiary mb-1">
                    Category Path
                  </label>
                  <input
                    type="text"
                    value={editForm.categoryPath}
                    onChange={(e) =>
                      setEditForm({ ...editForm, categoryPath: e.target.value })
                    }
                    placeholder="e.g., Passive/Resistors"
                    className="w-full bg-bg-input border border-border-default rounded-md px-3 py-2 text-sm text-text-primary focus:border-brand focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Variant Selector (if multiple) */}
          {hasMultipleVariants && (
            <div className="p-4 border-b border-border-default">
              <label className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-2 block">
                Package Variant
              </label>
              <select
                value={selectedVariantId || ""}
                onChange={(e) => {
                  setSelectedVariantId(e.target.value);
                  const variant = component.packageVariants?.find(
                    (v) => v.id === e.target.value,
                  );
                  if (
                    variant?.footprintOptions &&
                    variant.footprintOptions.length > 0
                  ) {
                    const defaultFp =
                      variant.footprintOptions.find((f) => f.isDefault) ||
                      variant.footprintOptions[0];
                    if (defaultFp) {
                      setSelectedFootprintId(defaultFp.id);
                    }
                  }
                }}
                className="w-full bg-bg-input border border-border-default rounded-md px-3 py-2 text-sm text-text-primary"
              >
                {component.packageVariants?.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.humanLabel}{" "}
                    {variant.id === component.defaultPackageVariantId
                      ? "(default)"
                      : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Technical Specifications */}
          <div className="p-4 border-b border-border-default">
            <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-3">
              Technical Specifications
            </h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-text-tertiary">Reference Prefix</dt>
                <dd className="text-text-primary font-medium">
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
                <dd className="text-text-primary capitalize">
                  {selectedVariant?.mountType || "—"}
                </dd>
              </div>
              {selectedVariant?.dimensions && (
                <>
                  <div className="flex justify-between">
                    <dt className="text-text-tertiary">Body Size</dt>
                    <dd className="text-text-primary">
                      {selectedVariant.dimensions.lengthMm} ×{" "}
                      {selectedVariant.dimensions.widthMm} mm
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
                  <dd className="text-text-primary">
                    {selectedVariant.imperialAlias}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {/* Pin Table */}
          <div className="p-4 border-b border-border-default">
            <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-3">
              Pin Assignments
            </h3>
            <PinTable pins={component.symbolData?.pinDefinitions} />
          </div>

          {/* Actions */}
          <div className="p-4">
            <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-3">
              Actions
            </h3>
            <div className="space-y-2">
              <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-brand text-white text-sm font-medium rounded-md hover:opacity-90 transition-opacity">
                <Plus className="h-4 w-4" />
                Use in Design
              </button>
              <button className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-border-default text-text-primary text-sm font-medium rounded-md hover:bg-bg-hover transition-colors">
                <Download className="h-4 w-4" />
                Export KiCAD Files
              </button>
              <div className="flex gap-2">
                <button className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-border-default text-text-secondary text-sm rounded-md hover:bg-bg-hover transition-colors">
                  <Copy className="h-4 w-4" />
                  Duplicate
                </button>
                {isWorkspaceComponent && (
                  <button
                    onClick={handleDeleteClick}
                    disabled={isDeleting}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2 border border-error text-error text-sm rounded-md hover:bg-error/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <Trash2 className="h-4 w-4" />
                    {isDeleting ? "Deleting..." : "Delete"}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-bg-elevated rounded-lg border border-border-default p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
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
            <p className="text-sm text-text-secondary mb-4">
              This will permanently remove{" "}
              <span className="font-medium text-text-primary">
                {component.displayLabel}
              </span>{" "}
              from your library. This action cannot be undone.
            </p>
            {saveError && (
              <p className="text-sm text-error mb-4">{saveError}</p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleCancelDelete}
                disabled={isDeleting}
                className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={isDeleting}
                className="px-4 py-2 bg-error text-white text-sm font-medium rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isDeleting ? "Deleting..." : "Delete Component"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
