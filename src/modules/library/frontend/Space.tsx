import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  ArrowDownAZ,
  Filter,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import type { LibraryComponent } from "../../../sdks/library";
import { ComponentDetailPage } from "./ComponentDetailPage";
import { TagFilterChips } from "./components/TagFilterChips";
import { useLibraryTags } from "./hooks/useLibraryTags";
import { groupTags } from "./tag-grouping";
import { commitKicadZipImportRequest } from "./import-wizard/import-api";
import {
  convertPendingModelConversion,
  ImportWizardPage,
} from "./import-wizard";
import { LibraryCard } from "./LibraryCard";
import { toUserError } from "./utils";

type LibrarySortKey = "name" | "recent";

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

function ActionButton({
  icon: Icon,
  label,
  primary,
  disabled,
  title,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  primary?: boolean;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
}): ReactElement {
  const base =
    "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-4 text-sm font-medium transition-all";
  const style = primary
    ? disabled
      ? "border-violet-400 bg-violet-400 text-white cursor-not-allowed opacity-60"
      : "border-violet-600 bg-violet-600 text-white hover:bg-violet-700 hover:border-violet-700 active:scale-[0.98]"
    : disabled
      ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500"
      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 active:scale-[0.98]";

  return (
    <button
      type="button"
      className={`${base} ${style}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      <Icon className="h-4 w-4" />
      <span>{label}</span>
    </button>
  );
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
      ? "border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
      : notice.variant === "warning"
        ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
        : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200";

  return (
    <div className="pointer-events-none fixed right-5 top-5 z-50">
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-auto flex max-w-md gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${variantClass}`}
      >
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{notice.title}</div>
          <div className="mt-0.5 text-xs opacity-90">{notice.message}</div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 opacity-70 transition hover:opacity-100"
          aria-label="Dismiss notification"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function sortComponents(
  list: LibraryComponent[],
  key: LibrarySortKey,
): LibraryComponent[] {
  const copy = [...list];
  if (key === "name") {
    copy.sort((a, b) => a.name.localeCompare(b.name));
  }
  // "recent" relies on backend ORDER BY name fallback today; preserved-as-fetched
  // is the closest proxy for newest-first until createdAt surfaces in the DTO.
  return copy;
}

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
  const [detailModelRefreshToken, setDetailModelRefreshToken] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [zipImporting, setZipImporting] = useState(false);
  const [notice, setNotice] = useState<LibraryNotice | null>(null);
  const [sortKey, setSortKey] = useState<LibrarySortKey>("name");
  const zipInputRef = useRef<HTMLInputElement | null>(null);

  const { tags: allTags } = useLibraryTags({
    backendURL,
    moduleId,
    excludeSystem: true,
    refreshToken: refreshTick,
  });

  const tagGroups = useMemo(
    () => groupTags(allTags, { excludeSystem: true, dropEmpty: true }),
    [allTags],
  );

  const selectionMode = selectedIds.size > 0;

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

  const handleBulkDelete = useCallback(async () => {
    if (selectedIds.size === 0 || !backendURL) return;

    const confirmed = window.confirm(
      `Delete ${selectedIds.size} component${selectedIds.size > 1 ? "s" : ""}? This will also remove orphaned symbols and footprints.`,
    );
    if (!confirmed) return;

    setDeleting(true);
    try {
      const response = await fetch(
        `${backendURL}/api/modules/${moduleId}/components/delete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [...selectedIds] }),
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
  }, [selectedIds, backendURL, moduleId]);

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

  const toggleTag = useCallback((tag: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
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

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  if (detailComponentId) {
    return (
      <>
        <ComponentDetailPage
          backendURL={backendURL}
          moduleId={moduleId}
          componentId={detailComponentId}
          modelRefreshToken={detailModelRefreshToken}
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
          <div className="flex h-full w-full items-center justify-center bg-slate-50 dark:bg-slate-950">
            <div className="text-sm text-slate-500 dark:text-slate-400">
              Loading wizard...
            </div>
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
    <div className="flex h-full w-full flex-col bg-slate-50 dark:bg-slate-950">
      <header className="flex items-center justify-between gap-6 border-b border-slate-200 bg-white px-6 py-3 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Library
        </h1>

        <div className="flex items-center gap-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search components..."
              className="h-9 w-72 rounded-lg border border-slate-300 bg-white pl-9 pr-3 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:border-violet-500"
            />
          </label>

          <ActionButton
            icon={Upload}
            label={zipImporting ? "Importing..." : "Upload ZIP"}
            disabled={zipImporting}
            onClick={() => zipInputRef.current?.click()}
          />
          <input
            ref={zipInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(event) => {
              void handleZipUpload(event.currentTarget.files?.[0] ?? null);
            }}
          />

          <ActionButton
            icon={Plus}
            label="New"
            primary
            disabled={zipImporting}
            onClick={() => setWizardOpen(true)}
          />
        </div>
      </header>

      <div className="flex flex-col gap-2 border-b border-slate-200 bg-slate-50/80 px-6 py-2.5 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="flex items-start gap-2">
          <Filter className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
          <div className="min-w-0 flex-1">
            <TagFilterChips
              groups={tagGroups}
              active={activeTags}
              onToggle={toggleTag}
              onClear={() => setActiveTags(new Set())}
            />
          </div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {components.length} component{components.length === 1 ? "" : "s"}
            {activeTags.size > 0
              ? ` · filtered by ${activeTags.size} tag${activeTags.size === 1 ? "" : "s"}`
              : ""}
          </span>
          <div className="flex items-center gap-3">
            <label className="flex select-none items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400">
              <ArrowDownAZ className="h-3.5 w-3.5 text-slate-400" />
              <span>Sort</span>
              <select
                value={sortKey}
                onChange={(event) =>
                  setSortKey(event.target.value as LibrarySortKey)
                }
                className="h-7 rounded-md border border-slate-300 bg-white px-2 text-[11px] text-slate-700 outline-none focus:border-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="name">Name</option>
                <option value="recent">As loaded</option>
              </select>
            </label>
            <label className="flex select-none items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={
                  selectableCount > 0 && selectedIds.size === selectableCount
                }
                onChange={toggleSelectAll}
                disabled={selectableCount === 0}
                className="h-4 w-4 cursor-pointer rounded border-slate-300 text-violet-600 focus:ring-violet-600 dark:border-slate-600"
              />
              <span>Select All</span>
            </label>
          </div>
        </div>
      </div>

      {selectionMode && (
        <div className="flex items-center gap-3 border-b border-violet-200 bg-violet-50 px-6 py-2 dark:border-violet-900 dark:bg-violet-950/50">
          <span className="text-sm font-medium text-violet-700 dark:text-violet-300">
            {selectedIds.size} selected
          </span>
          <button
            type="button"
            onClick={() => void handleBulkDelete()}
            disabled={deleting}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-red-300 bg-white px-3 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:bg-red-950 dark:text-red-400 dark:hover:bg-red-900"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {deleting ? "Deleting..." : "Delete"}
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        </div>
      )}

      <main className="flex-1 overflow-auto p-6">
        <section className="space-y-4">
          {loading && (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-violet-600" />
              Loading components...
            </div>
          )}
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {error}
            </div>
          )}

          {!loading && !error && components.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-12 text-center dark:border-slate-700 dark:bg-slate-900">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No components found.
              </p>
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                Import a component to get started.
              </p>
            </div>
          )}

          {!loading && !error && components.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-5">
              {sortComponents(components, sortKey).map((component) => (
                <LibraryCard
                  key={component.id}
                  component={component}
                  selected={selectedIds.has(component.id)}
                  onOpen={setDetailComponentId}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
          )}
        </section>
      </main>
      <NoticeViewport notice={notice} onDismiss={() => setNotice(null)} />
    </div>
  );
}
