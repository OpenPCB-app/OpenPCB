import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Search,
  Plus,
  Filter,
  Loader2,
  Trash2,
  Upload,
  X,
  AlertTriangle,
} from "lucide-react";
import { useComponents, type UseComponentsFilters } from "@/hooks/useComponents";
import { useNavigationStore } from "@/stores/navigation-store";
import { UnifiedImportModal } from "@/components/unified-import/UnifiedImportModal";
import {
  bulkDeleteComponentFamilies,
  type MountType,
} from "@/lib/api/component-api";

const MOUNT_TYPE_OPTIONS: Array<{ value: MountType; label: string }> = [
  { value: "smd", label: "SMD" },
  { value: "through_hole", label: "Through-hole" },
  { value: "virtual", label: "Virtual" },
];

export function LibraryScreen() {
  const [searchQuery, setSearchQuery] = useState("");
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [filters, setFilters] = useState<UseComponentsFilters>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const navigateToComponentDetail = useNavigationStore(
    (state) => state.navigateToComponentDetail,
  );

  const { components, loading, error, refetch } = useComponents({
    ...filters,
    search: searchQuery.trim() || undefined,
  });
  const hasSelection = selectedIds.size > 0;
  const isAllSelected = components.length > 0 && selectedIds.size === components.length;

  useEffect(() => {
    setSelectedIds((current) => {
      const next = new Set(
        Array.from(current).filter((id) => components.some((component) => component.id === id)),
      );

      return next.size === current.size ? current : next;
    });
  }, [components]);

  const toggleSelection = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
      return;
    }

    setSelectedIds(new Set(components.map((component) => component.id)));
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
  };

  const handleBulkDeleteClick = () => {
    setBulkDeleteError(null);
    setShowBulkDeleteConfirm(true);
  };

  const handleConfirmBulkDelete = async () => {
    if (selectedIds.size === 0) {
      return;
    }

    setIsBulkDeleting(true);
    setBulkDeleteError(null);

    try {
      const result = await bulkDeleteComponentFamilies(Array.from(selectedIds));
      setSelectedIds(new Set());
      void refetch();

      if (result.skippedCount > 0) {
        setBulkDeleteError(
          `${result.skippedCount} component${result.skippedCount === 1 ? " was" : "s were"} not deleted because it is in use.`,
        );
        return;
      }

      setShowBulkDeleteConfirm(false);
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

  const toggleMountType = (mountType: MountType) => {
    setFilters((current) => ({
      ...current,
      mountType: current.mountType === mountType ? undefined : mountType,
    }));
  };

  return (
    <>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border-default bg-bg-secondary px-6 py-3">
          <h1 className="text-lg font-medium text-text-primary">
            Component Library
          </h1>
          <div className="flex items-center gap-2">
            {hasSelection && (
              <div className="mr-2 flex items-center gap-2">
                <span className="text-sm text-text-secondary">
                  {selectedIds.size} selected
                </span>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-primary"
                  title="Clear selection"
                >
                  <X className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={handleBulkDeleteClick}
                  className="flex h-9 items-center gap-1.5 rounded-md border border-error px-4 text-sm font-medium text-error transition-colors hover:bg-error/10"
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Selected
                </button>
              </div>
            )}

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
              <input
                type="text"
                placeholder="Search components..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="h-9 w-64 rounded-md border border-border-default bg-bg-input pl-8 pr-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-border-strong focus:outline-none"
              />
            </div>

            <button
              type="button"
              className="flex h-9 items-center gap-1.5 rounded-md bg-brand px-4 text-sm font-medium text-white transition-opacity hover:opacity-90"
              onClick={() => navigateToComponentDetail()}
            >
              <Plus className="h-4 w-4" />
              New
            </button>

            <button
              type="button"
              className="flex h-9 items-center gap-1.5 rounded-md border border-border-default bg-bg-elevated px-4 text-sm font-medium text-text-primary transition-colors hover:bg-bg-secondary"
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
                  Mount:
                </span>
                <div className="flex gap-1">
                  {MOUNT_TYPE_OPTIONS.map((option) => (
                    <button
                      type="button"
                      key={option.value}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                        filters.mountType === option.value
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

            {components.length > 0 && (
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
                  className="cursor-pointer text-xs text-text-secondary"
                >
                  {isAllSelected ? "Deselect All" : "Select All"}
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {loading ? (
            <div className="flex h-64 items-center justify-center">
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

                  return (
                    <div
                      key={component.id}
                      className={cn(
                        "group relative rounded-lg",
                        isSelected && "ring-1 ring-brand",
                      )}
                    >
                      <div className="absolute left-2 top-2 z-10">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelection(component.id)}
                          className="h-4 w-4 rounded border-border-default text-brand focus:ring-brand"
                          aria-label={`Select ${component.displayLabel}`}
                        />
                      </div>
                      <button
                        type="button"
                        className={cn(
                          "w-full overflow-hidden rounded-lg border bg-bg-elevated text-left transition-colors hover:border-border-strong",
                          isSelected ? "border-brand" : "border-border-default",
                        )}
                        onClick={() => navigateToComponentDetail(component.id)}
                      >
                        <div className="flex h-20 items-center justify-center rounded-t-lg bg-bg-input">
                          <div className="text-4xl text-text-tertiary">
                            {component.symbolData.referencePrefix}
                          </div>
                        </div>
                        <div className="space-y-1 p-2.5">
                          <p className="truncate pr-6 text-[13px] font-medium text-text-primary">
                            {component.displayLabel}
                          </p>
                          <p className="line-clamp-2 text-[11px] text-text-muted">
                            {component.description || "No description"}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {component.packageVariants.slice(0, 2).map((variant) => (
                              <span
                                key={variant.id}
                                className="rounded bg-bg-input px-1.5 py-0.5 text-[9px] text-text-tertiary"
                              >
                                {variant.humanLabel}
                              </span>
                            ))}
                            {component.packageVariants.length > 2 && (
                              <span className="text-[9px] text-text-tertiary">
                                +{component.packageVariants.length - 2}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    </div>
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
        onImported={() => {
          void refetch();
        }}
      />

      {showBulkDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-lg border border-border-default bg-bg-elevated p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-error/10">
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
            <p className="mb-4 text-sm text-text-secondary">
              This will permanently remove {" "}
              <span className="font-medium text-text-primary">
                {selectedIds.size}
              </span>{" "}
              components from your library. This action cannot be undone.
            </p>
            {bulkDeleteError && (
              <p className="mb-4 text-sm text-error">{bulkDeleteError}</p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={handleCancelBulkDelete}
                disabled={isBulkDeleting}
                className="px-4 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmBulkDelete()}
                disabled={isBulkDeleting}
                className="rounded-md bg-error px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isBulkDeleting ? "Deleting..." : `Delete ${selectedIds.size} Components`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
