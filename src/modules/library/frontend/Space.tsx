import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { Download, LayoutGrid, Plus, Rows3, Trash2, X } from "lucide-react";
import {
  Button,
  Checkbox,
  SearchField,
  SegmentedControl,
  TooltipProvider,
} from "@shared/frontend/ui";
import { confirmDialog } from "@shared/frontend/ui/dialog-host-store";
import type { LibraryComponent } from "../../../sdks/library";
import { useNavigationStore } from "../../../core/frontend/src/stores/navigation-store";
import { ComponentDetailPage } from "./ComponentDetailPage";
import { ActiveFilterChips } from "./components/ActiveFilterChips";
import { CloudLibrarySyncButton } from "./components/CloudLibrarySyncButton";
import { FacetSidebar } from "./components/FacetSidebar";
import { LibraryPreviewPane } from "./components/LibraryPreviewPane";
import { LibraryTable } from "./components/LibraryTable";
import { useLibraryFacets } from "./hooks/useLibraryFacets";
import { commitKicadZipImportRequest } from "./import-wizard/import-api";
import {
  convertPendingModelConversion,
  ImportWizardPage,
} from "./import-wizard";
import { LibraryCard } from "./LibraryCard";
import { toUserError } from "./utils";

type LibraryView = "table" | "grid";

/** Persisted Table/Grid choice (PLAN D11). */
const VIEW_STORAGE_KEY = "openpcb.library.view";

function readStoredView(): LibraryView {
  try {
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === "grid"
      ? "grid"
      : "table";
  } catch {
    return "table";
  }
}

interface ModuleSpaceProps {
  moduleId: string;
  namespace?: string;
  backendURL?: string | null;
}

interface LibraryNotice {
  id: string;
  title: string;
  message: string;
  variant: "success" | "warning" | "error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readInstalledCorePackageSha(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const data = payload["data"];
  if (!isRecord(data)) return null;
  const status = data["status"];
  if (!isRecord(status)) return null;
  const installed = status["installed"];
  if (!isRecord(installed)) return null;
  const packageSha256 = installed["packageSha256"];
  return typeof packageSha256 === "string" ? packageSha256 : null;
}

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebounced(value);
    }, delayMs);

    return () => window.clearTimeout(handle);
  }, [delayMs, value]);

  return debounced;
}

function buildSearchUrl(
  backendURL: string | null | undefined,
  moduleId: string,
  query: string,
  tags: readonly string[],
): string | null {
  if (!backendURL) {
    return null;
  }

  const url = new URL(`${backendURL}/api/modules/${moduleId}/components`);
  const trimmed = query.trim();
  if (trimmed.length > 0) {
    url.searchParams.set("q", trimmed);
  }
  if (tags.length > 0) {
    url.searchParams.set("tags", tags.join(","));
  }
  url.searchParams.set("limit", "60");
  return url.toString();
}

function NoticeViewport({
  notice,
  onDismiss,
}: {
  notice: LibraryNotice | null;
  onDismiss: () => void;
}): ReactElement | null {
  if (!notice) return null;

  const variantClass =
    notice.variant === "error"
      ? "border-status-danger text-status-danger"
      : notice.variant === "warning"
        ? "border-status-warning text-status-warning"
        : "border-status-success text-status-success";

  return (
    <div className="pointer-events-none fixed right-3 top-3 z-50">
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-auto flex max-w-md gap-3 rounded-control border bg-surface-raised px-3 py-2 text-xs shadow-lg ${variantClass}`}
      >
        <div className="min-w-0 flex-1">
          <div className="font-medium">{notice.title}</div>
          <div className="mt-0.5 text-2xs text-text-secondary">
            {notice.message}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-text-tertiary transition-colors hover:text-text-strong"
          aria-label="Dismiss notification"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/**
 * The list is always name-ascending: the backend already orders by name and the
 * DTO carries no timestamp, so there is no second axis to offer.
 */
function sortByName(list: LibraryComponent[]): LibraryComponent[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

const VIEW_OPTIONS = [
  { id: "table" as const, label: "Table", icon: <Rows3 aria-hidden="true" /> },
  {
    id: "grid" as const,
    label: "Grid",
    icon: <LayoutGrid aria-hidden="true" />,
  },
];

export function LibrarySpace({
  backendURL,
  moduleId,
}: ModuleSpaceProps): ReactElement {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 180);
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [components, setComponents] = useState<LibraryComponent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [detailComponentId, setDetailComponentId] = useState<string | null>(
    null,
  );
  const navRoute = useNavigationStore((state) => state.currentRoute);
  useEffect(() => {
    if (navRoute.kind !== "module") return;
    if (navRoute.moduleId !== moduleId) return;
    const requested = navRoute.params?.componentId;
    if (requested && requested !== detailComponentId) {
      setDetailComponentId(requested);
    }
    // Only react to route changes that target this module.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navRoute, moduleId]);

  useEffect(() => {
    const onLibraryUpdated = () => setRefreshTick((value) => value + 1);
    window.addEventListener("openpcb:library-updated", onLibraryUpdated);
    return () =>
      window.removeEventListener("openpcb:library-updated", onLibraryUpdated);
  }, []);

  const [detailModelRefreshToken, setDetailModelRefreshToken] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [zipImporting, setZipImporting] = useState(false);
  const [notice, setNotice] = useState<LibraryNotice | null>(null);
  const [view, setView] = useState<LibraryView>(readStoredView);
  /** Row highlighted in the table; drives the preview pane (PLAN D11). */
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(
    null,
  );
  const zipInputRef = useRef<HTMLInputElement | null>(null);
  const installedCoreShaRef = useRef<string | null>(null);

  const selectionMode = selectedIds.size > 0;

  useEffect(() => {
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // Storage disabled (private mode): the choice just doesn't persist.
    }
  }, [view]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectableCount = useMemo(
    () => components.filter((c) => !c.isBuiltin).length,
    [components],
  );

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === selectableCount && selectableCount > 0) {
        return new Set();
      }
      return new Set(components.filter((c) => !c.isBuiltin).map((c) => c.id));
    });
  }, [components, selectableCount]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  /** Shared by the bulk toolbar and the preview pane's overflow menu. */
  const deleteComponents = useCallback(
    async (ids: readonly string[]) => {
      if (ids.length === 0 || !backendURL) return;

      const confirmed = await confirmDialog({
        title: `Delete ${ids.length} component${ids.length > 1 ? "s" : ""}?`,
        description:
          "This will also remove orphaned symbols and footprints. This cannot be undone.",
        confirmLabel: "Delete",
        tone: "danger",
      });
      if (!confirmed) return;

      setDeleting(true);
      try {
        const response = await fetch(
          `${backendURL}/api/modules/${moduleId}/components/delete`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids: [...ids] }),
          },
        );
        const payload = (await response.json().catch(() => null)) as unknown;
        if (!response.ok) {
          throw new Error(
            toUserError(payload, `Delete failed (HTTP ${response.status})`),
          );
        }
        setSelectedIds(new Set());
        setRefreshTick((v) => v + 1);
      } catch (deleteError) {
        setError(
          deleteError instanceof Error
            ? deleteError.message
            : "Failed to delete components",
        );
      } finally {
        setDeleting(false);
      }
    },
    [backendURL, moduleId],
  );

  const handleBulkDelete = useCallback(
    () => deleteComponents([...selectedIds]),
    [deleteComponents, selectedIds],
  );

  const handleDeleteComponent = useCallback(
    (componentId: string) => {
      void deleteComponents([componentId]);
    },
    [deleteComponents],
  );

  const handleZipUpload = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      if (!backendURL) {
        setError("Backend URL unavailable");
        return;
      }
      setZipImporting(true);
      setError(null);
      const controller = new AbortController();
      try {
        const result = await commitKicadZipImportRequest(
          backendURL,
          moduleId,
          file,
          controller.signal,
        );
        setRefreshTick((value) => value + 1);
        setDetailComponentId(result.componentId);
        const hasPendingModelConversion =
          result.modelConversion?.status === "pending_client_conversion";
        if (hasPendingModelConversion && result.modelConversion) {
          setNotice({
            id: crypto.randomUUID(),
            title: "Converting 3D model",
            message: "Component imported. Converting 3D model…",
            variant: "success",
          });
          void convertPendingModelConversion({
            backendURL,
            moduleId,
            conversion: result.modelConversion,
            signal: controller.signal,
            onProgress: (status, message) => {
              setNotice({
                id: crypto.randomUUID(),
                title:
                  status === "failed"
                    ? "3D model conversion failed"
                    : status === "ready"
                      ? "3D model ready"
                      : "Converting 3D model",
                message:
                  message ??
                  (status === "ready" ? "Ready" : "Converting 3D model…"),
                variant: status === "failed" ? "warning" : "success",
              });
            },
          })
            .catch((conversionError) => {
              setNotice({
                id: crypto.randomUUID(),
                title: "3D model conversion failed",
                message:
                  conversionError instanceof Error
                    ? conversionError.message
                    : "Imported component remains available without a 3D model.",
                variant: "warning",
              });
            })
            .finally(() => {
              setDetailModelRefreshToken((token) => token + 1);
            });
        }
        if (result.warnings.length > 0) {
          const firstWarning = result.warnings[0];
          setNotice({
            id: crypto.randomUUID(),
            title: "Imported with warnings",
            message:
              result.warnings.length === 1
                ? (firstWarning?.message ??
                  "Review imported component metadata.")
                : `${firstWarning?.message ?? "Review imported component metadata."} +${result.warnings.length - 1} more`,
            variant: "warning",
          });
        } else if (!hasPendingModelConversion) {
          setNotice({
            id: crypto.randomUUID(),
            title: result.reused
              ? "Existing component opened"
              : "Component imported",
            message: result.componentName,
            variant: "success",
          });
        }
      } catch (zipError) {
        const message =
          zipError instanceof Error
            ? zipError.message
            : "Failed to import ZIP archive";
        setError(message);
        setNotice({
          id: crypto.randomUUID(),
          title: "ZIP import failed",
          message,
          variant: "error",
        });
      } finally {
        setZipImporting(false);
        if (zipInputRef.current) {
          zipInputRef.current.value = "";
        }
      }
    },
    [backendURL, moduleId],
  );

  const tagsKey = useMemo(() => [...activeTags].sort().join(","), [activeTags]);
  const searchUrl = useMemo(
    () =>
      buildSearchUrl(
        backendURL,
        moduleId,
        debouncedQuery,
        tagsKey.length > 0 ? tagsKey.split(",") : [],
      ),
    [backendURL, moduleId, debouncedQuery, tagsKey],
  );

  const { facets } = useLibraryFacets({
    backendURL,
    moduleId,
    query: debouncedQuery,
    tagsKey,
    refreshToken: refreshTick,
  });

  useEffect(() => {
    if (!import.meta.env.DEV || !backendURL) return;

    let stopped = false;
    let controller: AbortController | null = null;

    const pollStatus = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(
          `${backendURL}/api/modules/${moduleId}/core-library/status`,
          { signal: controller.signal },
        );
        if (!response.ok) return;
        const packageSha256 = readInstalledCorePackageSha(await response.json());
        if (!packageSha256 || stopped) return;
        if (
          installedCoreShaRef.current !== null &&
          installedCoreShaRef.current !== packageSha256
        ) {
          setRefreshTick((value) => value + 1);
          setDetailModelRefreshToken((value) => value + 1);
        }
        installedCoreShaRef.current = packageSha256;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (error instanceof Error) return;
      }
    };

    void pollStatus();
    const interval = window.setInterval(() => void pollStatus(), 2_000);
    return () => {
      stopped = true;
      controller?.abort();
      window.clearInterval(interval);
    };
  }, [backendURL, moduleId]);

  const toggleTag = useCallback((tag: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

  const clearAllFilters = useCallback(() => {
    setActiveTags(new Set());
  }, []);

  useEffect(() => {
    if (!searchUrl) {
      setComponents([]);
      setError("Backend URL unavailable");
      return;
    }

    const controller = new AbortController();
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(searchUrl, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = (await response.json()) as {
          data?: { components?: LibraryComponent[] };
        };
        setComponents(payload.data?.components ?? []);
      } catch (fetchError) {
        if (controller.signal.aborted) {
          return;
        }
        setComponents([]);
        setError(
          fetchError instanceof Error
            ? fetchError.message
            : "Failed to load components",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };
    void run();

    return () => controller.abort();
  }, [searchUrl, refreshTick]);

  useEffect(() => {
    setSelectedIds((prev) => (prev.size === 0 ? prev : new Set()));
  }, [components]);

  // Drop the preview selection when the highlighted row leaves the result set.
  useEffect(() => {
    setSelectedComponentId((prev) =>
      prev && components.some((component) => component.id === prev)
        ? prev
        : null,
    );
  }, [components]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const sorted = useMemo(() => sortByName(components), [components]);
  // The preview pane always shows a part (design 3b): default to the first row.
  useEffect(() => {
    const first = sorted[0];
    if (selectedComponentId || !first) return;
    setSelectedComponentId(first.id);
  }, [selectedComponentId, sorted]);
  const totalCount = facets.total > 0 ? facets.total : components.length;
  const sourceCount = facets.source.length;

  if (detailComponentId) {
    return (
      <>
        <ComponentDetailPage
          backendURL={backendURL}
          moduleId={moduleId}
          componentId={detailComponentId}
          modelRefreshToken={detailModelRefreshToken}
          refreshToken={refreshTick}
          onBack={() => setDetailComponentId(null)}
          onCloned={(newId) => {
            setRefreshTick((value) => value + 1);
            setDetailComponentId(newId);
          }}
        />
        <NoticeViewport notice={notice} onDismiss={() => setNotice(null)} />
      </>
    );
  }

  if (wizardOpen) {
    return (
      <Suspense
        fallback={
          <div className="flex h-full w-full items-center justify-center bg-surface-app">
            <div className="text-xs text-text-tertiary">Loading wizard...</div>
          </div>
        }
      >
        <ImportWizardPage
          backendURL={backendURL}
          moduleId={moduleId}
          onClose={() => setWizardOpen(false)}
          onImported={() => setRefreshTick((value) => value + 1)}
        />
      </Suspense>
    );
  }

  return (
    <div className="flex h-full w-full flex-col bg-surface-app">
      <header className="flex h-[34px] shrink-0 items-center gap-2 border-b border-border bg-surface-rail px-3">
        <h1 className="text-base font-medium text-text-strong">Library</h1>
        <span className="font-mono text-2xs tabular-nums text-text-tertiary">
          {totalCount} part{totalCount === 1 ? "" : "s"} · {sourceCount} source
          {sourceCount === 1 ? "" : "s"}
        </span>

        <SearchField
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, MPN, package…"
          shortcutHint="/"
          containerClassName="ml-2 w-[320px] shrink-0"
        />

        <div className="flex-1" />

        <SegmentedControl
          aria-label="Result view"
          options={VIEW_OPTIONS}
          value={view}
          onChange={setView}
        />

        <Button
          type="button"
          variant="outline"
          icon={<Download className="h-3 w-3" />}
          disabled={zipImporting}
          onClick={() => zipInputRef.current?.click()}
        >
          {zipImporting ? "Importing…" : "Import library…"}
        </Button>
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          onChange={(event) => {
            void handleZipUpload(event.currentTarget.files?.[0] ?? null);
          }}
        />

        <CloudLibrarySyncButton
          backendURL={backendURL}
          moduleId={moduleId}
          onChanged={() => setRefreshTick((value) => value + 1)}
        />

        <Button
          type="button"
          variant="primary"
          icon={<Plus className="h-3 w-3" />}
          disabled={zipImporting}
          onClick={() => setWizardOpen(true)}
        >
          New part
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <FacetSidebar
          facets={facets}
          activeFilters={activeTags}
          onToggle={toggleTag}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[26px] shrink-0 items-center gap-2 border-b border-border px-2.5 text-2xs text-text-tertiary">
            <ActiveFilterChips
              activeFilters={activeTags}
              facets={facets}
              onRemove={toggleTag}
              onClearAll={clearAllFilters}
            />
            <span className="shrink-0 font-mono text-2xs tabular-nums">
              {components.length} of {totalCount}
            </span>
            <div className="flex-1" />
            <Checkbox
              checked={
                selectableCount > 0 && selectedIds.size === selectableCount
              }
              onChange={toggleSelectAll}
              disabled={selectableCount === 0}
              label="Select All"
              wrapperClassName="text-2xs text-text-tertiary"
            />
          </div>

          {selectionMode && (
            <div className="flex h-[26px] shrink-0 items-center gap-2 border-b border-border bg-surface-section px-2.5">
              <span className="text-2xs font-medium text-text-strong">
                {selectedIds.size} selected
              </span>
              <Button
                type="button"
                size="sm"
                onClick={() => void handleBulkDelete()}
                disabled={deleting}
                icon={<Trash2 className="h-3 w-3" />}
                className="text-status-danger hover:text-status-danger"
              >
                {deleting ? "Deleting..." : "Delete"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={clearSelection}
                icon={<X className="h-3 w-3" />}
              >
                Clear
              </Button>
            </div>
          )}

          {loading && (
            <div className="px-3 py-3 text-xs text-text-tertiary">
              Loading components...
            </div>
          )}
          {error && (
            <div className="border-b border-border px-3 py-2 text-xs text-status-danger">
              {error}
            </div>
          )}

          {!loading && !error && components.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 px-4 text-center">
              <p className="text-xs text-text-secondary">
                No components match the current filters.
              </p>
              <p className="text-2xs text-text-tertiary">
                {activeTags.size > 0
                  ? "Try clearing some filters."
                  : "Import a component to get started."}
              </p>
            </div>
          )}

          {!loading && !error && components.length > 0 ? (
            view === "table" ? (
              <LibraryTable
                components={sorted}
                selectedIds={selectedIds}
                selectionMode={selectionMode}
                selectedComponentId={selectedComponentId}
                onSelectRow={setSelectedComponentId}
                onOpen={setDetailComponentId}
                onToggleSelect={toggleSelect}
              />
            ) : (
              <main className="min-h-0 flex-1 overflow-auto p-3">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
                  {sorted.map((component) => (
                    <LibraryCard
                      key={component.id}
                      component={component}
                      moduleId={moduleId}
                      backendURL={backendURL}
                      selected={selectedIds.has(component.id)}
                      onOpen={setDetailComponentId}
                      onToggleSelect={toggleSelect}
                    />
                  ))}
                </div>
              </main>
            )
          ) : null}
        </div>

        {view === "table" ? (
          <TooltipProvider>
            <LibraryPreviewPane
              backendURL={backendURL}
              moduleId={moduleId}
              componentId={selectedComponentId}
              onOpen={setDetailComponentId}
              onDelete={handleDeleteComponent}
              refreshToken={refreshTick}
            />
          </TooltipProvider>
        ) : null}
      </div>
      <NoticeViewport notice={notice} onDismiss={() => setNotice(null)} />
    </div>
  );
}
