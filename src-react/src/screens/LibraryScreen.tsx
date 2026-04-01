import { useState, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Search, Plus, Filter, Loader2, FileEdit, Trash2 } from "lucide-react";
import { useComponents, type UseComponentsFilters } from "@/hooks/useComponents";
import { useDrafts } from "@/hooks/useDrafts";
import { ComponentDetailPanel } from "@/components/library/ComponentDetailPanel";
import { ComponentWizard } from "@/components/wizard/ComponentWizard";
import { discardComponentDraft } from "@/lib/api/component-api";
import type { ComponentFamilyType } from "@/../../src-ts/src/core/schemas/component-library.schema";

const MOUNT_TYPE_OPTIONS = [
  { value: "smd" as const, label: "SMD" },
  { value: "through_hole" as const, label: "Through-hole" },
  { value: "virtual" as const, label: "Virtual" },
];

export function LibraryScreen() {
  const [searchQuery, setSearchQuery] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  // TODO: Pass to ComponentWizard when draft resume is implemented
  const [_resumeDraftId, setResumeDraftId] = useState<string | null>(null);
  const [selectedComponent, setSelectedComponent] =
    useState<ComponentFamilyType | null>(null);
  const [filters, setFilters] = useState<UseComponentsFilters>({});

  const { components, loading, error, refetch } = useComponents({
    ...filters,
    search: searchQuery.trim() || undefined,
  });

  const { drafts, loading: draftsLoading, refetch: refetchDrafts } = useDrafts();

  // Handle wizard close
  const handleWizardClose = useCallback(() => {
    setWizardOpen(false);
    setResumeDraftId(null);
    // Refetch drafts in case one was created/updated
    refetchDrafts();
  }, [refetchDrafts]);

  // Handle successful publish
  const handlePublished = useCallback(
    (familyId: string) => {
      // Refetch components to show the new one
      refetch();
      refetchDrafts();
      // Auto-select the newly published component
      const newComponent = components.find((c) => c.id === familyId);
      if (newComponent) {
        setSelectedComponent(newComponent);
      }
    },
    [refetch, refetchDrafts, components],
  );

  // Handle draft resume (TODO: implement full resume)
  const handleResumeDraft = useCallback((draftId: string) => {
    setResumeDraftId(draftId);
    setWizardOpen(true);
  }, []);

  // Handle draft discard
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

  // Show wizard full-screen when open
  if (wizardOpen) {
    return (
      <ComponentWizard
        onClose={handleWizardClose}
        onPublished={handlePublished}
        // resumeDraftId={resumeDraftId} // TODO: implement resume
      />
    );
  }

  const toggleMountType = (mountType: typeof MOUNT_TYPE_OPTIONS[number]["value"]) => {
    const currentTypes = filters.mountTypes ?? [];
    const newTypes = currentTypes.includes(mountType)
      ? currentTypes.filter((t) => t !== mountType)
      : [...currentTypes, mountType];

    setFilters({ ...filters, mountTypes: newTypes.length > 0 ? newTypes : undefined });
  };

  const hasDrafts = drafts.length > 0;

  return (
    <>
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-default bg-bg-secondary px-6 py-3">
          <h1 className="text-lg font-medium text-text-primary">
            Component Library
          </h1>
          <div className="flex items-center gap-2">
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
          </div>
        </div>

        {/* Filters */}
        <div className="border-b border-border-default bg-bg-secondary px-6 py-3">
          <div className="flex items-center gap-4">
            {/* Scope filter */}
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-text-tertiary" />
              <span className="text-xs font-medium text-text-secondary">Scope:</span>
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
                  onClick={() => setFilters({ ...filters, scope: "built_in" })}
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
                  onClick={() => setFilters({ ...filters, scope: "workspace" })}
                >
                  Workspace
                </button>
              </div>
            </div>

            {/* Mount type chips */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-text-secondary">Mount:</span>
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
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-auto p-6">
          {/* Pending Drafts Section */}
          {hasDrafts && !draftsLoading && (
            <div className="mb-6">
              <h2 className="text-sm font-medium text-text-secondary mb-3 flex items-center gap-2">
                <FileEdit className="h-4 w-4" />
                Pending Drafts ({drafts.length})
              </h2>
              <div className="flex gap-3 flex-wrap">
                {drafts.map((draft) => {
                  const payload = draft.payload as { displayLabel?: string } | null;
                  const label = payload?.displayLabel || "Untitled Component";
                  const updatedAt = new Date(draft.updatedAt).toLocaleDateString();

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

          {/* Components Grid */}
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
                {components.map((component) => (
                  <article
                    key={component.id}
                    className="group rounded-lg border border-border-default bg-bg-elevated hover:border-border-strong transition-colors cursor-pointer"
                    onClick={() => setSelectedComponent(component)}
                  >
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
                        {component.packageVariants.slice(0, 2).map((variant) => (
                          <span
                            key={variant.id}
                            className="text-[9px] bg-bg-input px-1.5 py-0.5 rounded text-text-tertiary"
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
                  </article>
                ))}
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

      {/* Detail panel */}
      {selectedComponent && (
        <ComponentDetailPanel
          component={selectedComponent}
          onClose={() => setSelectedComponent(null)}
        />
      )}
    </>
  );
}
