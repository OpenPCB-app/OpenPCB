import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { Filter, Plus, Search, Trash2, X, type LucideIcon } from "lucide-react";
import type { LibraryComponent } from "../../../core/contracts/modules/sdk";
import { ComponentDetailPage } from "./ComponentDetailPage";
import { ImportWizardPage } from "./import-wizard";
import { LibraryCard } from "./LibraryCard";
import { toUserError } from "./utils";

interface ModuleSpaceProps {
  moduleId: string;
  namespace?: string;
  backendURL?: string | null;
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
): string | null {
  if (!backendURL) {
    return null;
  }

  const url = new URL(`${backendURL}/api/modules/${moduleId}/components`);
  const trimmed = query.trim();
  if (trimmed.length > 0) {
    url.searchParams.set("q", trimmed);
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

function FilterChip({
  label,
  disabled,
}: {
  label: string;
  disabled?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      title="Coming soon"
      className="rounded-full px-3 py-1 text-xs font-medium bg-slate-100 text-slate-400 cursor-not-allowed dark:bg-slate-800 dark:text-slate-500"
    >
      {label}
    </button>
  );
}

export function LibrarySpace({
  backendURL,
  moduleId,
}: ModuleSpaceProps): ReactElement {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 180);
  const [components, setComponents] = useState<LibraryComponent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [detailComponentId, setDetailComponentId] = useState<string | null>(
    null,
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

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

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (prev.size === components.length && components.length > 0) {
        return new Set();
      }
      return new Set(components.map((c) => c.id));
    });
  }, [components]);

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

  const searchUrl = useMemo(
    () => buildSearchUrl(backendURL, moduleId, debouncedQuery),
    [backendURL, moduleId, debouncedQuery],
  );

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

  if (detailComponentId) {
    return (
      <ComponentDetailPage
        backendURL={backendURL}
        moduleId={moduleId}
        componentId={detailComponentId}
        onBack={() => setDetailComponentId(null)}
      />
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
            icon={Plus}
            label="New"
            primary
            onClick={() => setWizardOpen(true)}
          />
        </div>
      </header>

      <div className="flex items-center justify-between gap-4 border-b border-slate-200 bg-slate-50/80 px-6 py-2.5 dark:border-slate-800 dark:bg-slate-900/50">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Mount:
          </span>
          <div className="flex items-center gap-1.5">
            <FilterChip label="SMD" disabled />
            <FilterChip label="Through-hole" disabled />
            <FilterChip label="Virtual" disabled />
          </div>
        </div>

        <label className="flex select-none items-center gap-2 text-xs text-slate-600 dark:text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            checked={
              components.length > 0 && selectedIds.size === components.length
            }
            onChange={toggleSelectAll}
            disabled={components.length === 0}
            className="h-4 w-4 cursor-pointer rounded border-slate-300 text-violet-600 focus:ring-violet-600 dark:border-slate-600"
          />
          <span>Select All</span>
        </label>
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
              {components.map((component) => (
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
    </div>
  );
}
