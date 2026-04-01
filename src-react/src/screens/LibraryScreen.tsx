import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Search,
  Plus,
  Filter,
  Loader2,
  FileEdit,
  Trash2,
  Upload,
  X,
  AlertTriangle,
} from "lucide-react";
import {
  useComponents,
  type UseComponentsFilters,
} from "@/hooks/useComponents";
import { useDrafts } from "@/hooks/useDrafts";
import { useNavigationStore } from "@/stores/navigation-store";
import { ComponentWizard } from "@/components/wizard/ComponentWizard";
import { UnifiedImportModal } from "@/components/unified-import/UnifiedImportModal";
import {
  discardComponentDraft,
  bulkDeleteComponentFamilies,
} from "@/lib/api/component-api";

const MOUNT_TYPE_OPTIONS = [
  { value: "smd" as const, label: "SMD" },
  { value: "through_hole" as const, label: "Through-hole" },
  { value: "virtual" as const, label: "Virtual" },
];

export function LibraryScreen() {
  const [searchQuery, setSearchQuery] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [_resumeDraftId, setResumeDraftId] = useState<string | null>(null);
  const [filters, setFilters] = useState<UseComponentsFilters>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const navigateToComponentDetail = useNavigationStore(
    (s) => s.navigateToComponentDetail,
  );

  const { components, loading, error, refetch } = useComponents({
    ...filters,
    search: searchQuery.trim() || undefined,
  });

  const {
    drafts,
    loading: draftsLoading,
    refetch: refetchDrafts,
  } = useDrafts();

  const deletableComponents = components.filter((c) => c.scope === "workspace");
  const hasSelection = selectedIds.size > 0;
  const isAllSelected =
    deletableComponents.length > 0 &&
    selectedIds.size === deletableComponents.length;

  const handleWizardClose = useCallback(() => {
    setWizardOpen(false);
    setResumeDraftId(null);
    refetchDrafts();
  }, [refetchDrafts]);

  const handlePublished = useCallback(
    (familyId: string) => {
      refetch();
      refetchDrafts();
      navigateToComponentDetail(familyId);
    },
    [refetch, refetchDrafts, navigateToComponentDetail],
  );

  const handleResumeDraft = useCallback((draftId: string) => {
    setResumeDraftId(draftId);
    setWizardOpen(true);
  }, []);

  const handleDiscardDraft = useCallback(
    async (draftId: string) => {
      try {
        await discardComponentDraft(draftId);
        refetchDrafts();
      } catch (err) {
        console.error("Failed to discard draft:", err);
      }
    },
    [refetchDrafts],
  );

  const toggleSelection = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      const allDeletableIds = deletableComponents.map((c) => c.id);
      setSelectedIds(new Set(allDeletableIds));
    }
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleBulkDeleteClick = () => {
    setBulkDeleteError(null);
    setShowBulkDeleteConfirm(true);
  };

  const handleConfirmBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsBulkDeleting(true);
    setBulkDeleteError(null);
    try {
      await bulkDeleteComponentFamilies(Array.from(selectedIds));
      setSelectedIds(new Set());
      setShowBulkDeleteConfirm(false);
      refetch();
    } catch (err) {
      setBulkDeleteError(
        err instanceof Error ? err.message : "Failed to delete components",
      );
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleCancelBulkDelete = () => {
    setShowBulkDeleteConfirm(false);
    setBulkDeleteError(null);
  };

  if (wizardOpen) {
    return (
      <ComponentWizard
        onClose={handleWizardClose}
        onPublished={handlePublished}
      />
    );
  }

  const toggleMountType = (
    mountType: (typeof MOUNT_TYPE_OPTIONS)[number]["value"],
  ) => {
    const currentTypes = filters.mountTypes ?? [];
    const newTypes = currentTypes.includes(mountType)
      ? currentTypes.filter((t) => t !== mountType)
      : [...currentTypes, mountType];

    setFilters({
      ...filters,
      mountTypes: newTypes.length > 0 ? newTypes : undefined,
    });
  };

  const hasDrafts = drafts.length > 0;

  return (
    <>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border-default bg-bg-secondary px-6 py-3">
          <h1 className="text-lg font-medium text-text-primary">
            Component Library
          </h1>
          <div className="flex items-center gap-2">
            {hasSelection && (
              <div className="flex items-center gap-2 mr-2">
                <span className="text-sm text-text-secondary">
                  {selectedIds.size} selected
                </span>
                <button
                  onClick={clearSelection}
                  className="h-8 w-8 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover flex items-center justify-center"
                  title="Clear selection"
                >
                  <X className="h-4 w-4" />
                </button>
                <button
                  onClick={handleBulkDeleteClick}
                  className="flex items-center gap-1.5 h-9 rounded-md border border-error text-error px-4 text-sm font-medium hover:bg-error/10 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Selected
                </button>
              </div>
            )}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-tertiary" />
              <input
                type="text"
                placeholder="Search components..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 w-64 rounded-md bg-bg-input pl-8 pr-3 text-sm text-text-primary placeholder:text-text-tertiary border border-border-default focus:border-border-strong focus:outline-none"
              />
            </div>
            <button
              className="flex items-center gap-1.5 h-9 rounded-md bg-brand px-4 text-sm font-medium text-white hover:opacity-90 transition-opacity"
              onClick={() => setWizardOpen(true)}
            >
              <Plus className="h-4 w-4" />
              New
            </button>
            <button
              className="flex items-center gap-1.5 h-9 rounded-md bg-bg-elevated border border-border-default px-4 text-sm font-medium text-text-primary hover:bg-bg-secondary transition-colors"
              onClick={() => setImportModalOpen(true)}
            >
              <Upload className="h-4 w-4" />
              Import
            </button>
          </div>
        </div>

        <div className="border-b border-border-default bg-bg-secondary px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-text-tertiary" />
                <span className="text-xs font-medium text-text-secondary">
                  Scope:
                </span>
                <div className="flex gap-1">
                  <button
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                      !filters.scope
                        ? "bg-brand-bg text-brand"
                        : "bg-bg-input text-text-tertiary hover:text-text-secondary",
                    )}
                    onClick={() => setFilters({ ...filters, scope: undefined })}
                  >
                    All
                  </button>
                  <button
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                      filters.scope === "built_in"
                        ? "bg-brand-bg text-brand"
                        : "bg-bg-input text-text-tertiary hover:text-text-secondary",
                    )}
                    onClick={() =>
                      setFilters({ ...filters, scope: "built_in" })
                    }
                  >
                    Built-in
                  </button>
                  <button
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                      filters.scope === "workspace"
                        ? "bg-brand-bg text-brand"
                        : "bg-bg-input text-text-tertiary hover:text-text-secondary",
                    )}
                    onClick={() =>
                      setFilters({ ...filters, scope: "workspace" })
                    }
                  >
                    Workspace
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-text-secondary">
                  Mount:
                </span>
                <div className="flex gap-1">
                  {MOUNT_TYPE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                        filters.mountTypes?.includes(option.value)
                          ? "bg-brand-bg text-brand"
                          : "bg-bg-input text-text-tertiary hover:text-text-secondary",
                      )}
                      onClick={() => toggleMountType(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {deletableComponents.length > 0 && (
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isAllSelected}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 rounded border-border-default text-brand focus:ring-brand"
                  id="select-all"
                />
                <label
                  htmlFor="select-all"
                  className="text-xs text-text-secondary cursor-pointer"
                >
                  {isAllSelected ? "Deselect All" : "Select All Deletable"}
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {hasDrafts && !draftsLoading && (
            <div className="mb-6">
              <h2 className="text-sm font-medium text-text-secondary mb-3 flex items-center gap-2">
                <FileEdit className="h-4 w-4" />
                Pending Drafts ({drafts.length})
              </h2>
              <div className="flex gap-3 flex-wrap">
                {drafts.map((draft) => {
                  const payload = draft.payload as {
                    displayLabel?: string;
                  } | null;
                  const label = payload?.displayLabel || "Untitled Component";
                  const updatedAt = new Date(
                    draft.updatedAt,
                  ).toLocaleDateString();

                  return (
                    <div
                      key={draft.id}
                      className="group flex items-center gap-3 rounded-lg border border-dashed border-border-default bg-bg-elevated px-4 py-3 hover:border-brand transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">
                          {label}
                        </p>
                        <p className="text-xs text-text-muted">
                          Last edited: {updatedAt}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          className="h-8 px-3 rounded-md bg-bg-input text-xs font-medium text-text-secondary hover:bg-bg-secondary transition-colors"
                          onClick={() => handleResumeDraft(draft.id)}
                        >
                          Continue
                        </button>
                        <button
                          className="h-8 w-8 rounded-md text-text-muted hover:text-error hover:bg-error/10 transition-colors flex items-center justify-center"
                          onClick={() => handleDiscardDraft(draft.id)}
                          title="Discard draft"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-64">
              <Loader2 className="h-8 w-8 animate-spin text-text-tertiary" />
            </div>
          ) : error ? (
            <div className="mt-4 rounded-lg border border-border-default bg-bg-secondary px-4 py-8 text-center">
              <p className="text-sm text-error">{error}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
                {components.map((component) => {
                  const isSelected = selectedIds.has(component.id);
                  const isWorkspace = component.scope === "workspace";

                  return (
                    <article
                      key={component.id}
                      className={cn(
                        "group rounded-lg border bg-bg-elevated hover:border-border-strong transition-colors cursor-pointer relative",
                        isSelected
                          ? "border-brand ring-1 ring-brand"
                          : "border-border-default",
                      )}
                      onClick={(e) => {
                        if (
                          e.target instanceof HTMLInputElement ||
                          (e.target as HTMLElement).closest(".checkbox-wrapper")
                        ) {
                          return;
                        }
                        navigateToComponentDetail(component.id);
                      }}
                    >
                      {isWorkspace && (
                        <div
                          className="checkbox-wrapper absolute top-2 left-2 z-10"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelection(component.id)}
                            className="h-4 w-4 rounded border-border-default text-brand focus:ring-brand"
                          />
                        </div>
                      )}
                      <div className="flex h-20 items-center justify-center rounded-t-lg bg-bg-input">
                        <div className="text-4xl text-text-tertiary">
                          {component.symbolData.referencePrefix}
                        </div>
                      </div>
                      <div className="space-y-1 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-[13px] font-medium text-text-primary">
                            {component.displayLabel}
                          </p>
                          <span className="rounded-full bg-bg-input px-2 py-0.5 text-[10px] font-medium tracking-wide text-text-muted uppercase">
                            {component.scope}
                          </span>
                        </div>
                        <p className="text-[11px] text-text-muted line-clamp-2">
                          {component.description || "No description"}
                        </p>
                        <div className="flex gap-1 mt-1.5 flex-wrap">
                          {component.packageVariants
                            ?.slice(0, 2)
                            .map((variant) => (
                              <span
                                key={variant.id}
                                className="text-[9px] bg-bg-input px-1.5 py-0.5 rounded text-text-tertiary"
                              >
                                {variant.humanLabel}
                              </span>
                            ))}
                          {component.packageVariants &&
                            component.packageVariants.length > 2 && (
                              <span className="text-[9px] text-text-tertiary">
                                +{component.packageVariants.length - 2}
                              </span>
                            )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
              {components.length === 0 && (
                <div className="mt-4 rounded-lg border border-dashed border-border-default bg-bg-secondary px-4 py-8 text-center">
                  <p className="text-sm text-text-muted">
                    No components match the current filters.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <UnifiedImportModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        workspaceId="default"
      />

      {showBulkDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-bg-elevated rounded-lg border border-border-default p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-error" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-text-primary">
                  Delete {selectedIds.size} Components
                </h3>
                <p className="text-sm text-text-secondary">
                  Are you sure you want to delete these components?
                </p>
              </div>
            </div>
            <p className="text-sm text-text-secondary mb-4">
              This will permanently remove{" "}
              <span className="font-medium text-text-primary">
                {selectedIds.size}
              </span>{" "}
              components from your library. This action cannot be undone.
            </p>
            {bulkDeleteError && (
              <p className="text-sm text-error mb-4">{bulkDeleteError}</p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                onClick={handleCancelBulkDelete}
                disabled={isBulkDeleting}
                className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmBulkDelete}
                disabled={isBulkDeleting}
                className="px-4 py-2 bg-error text-white text-sm font-medium rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isBulkDeleting
                  ? "Deleting..."
                  : `Delete ${selectedIds.size} Components`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
