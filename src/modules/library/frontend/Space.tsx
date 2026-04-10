import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Filter, Plus, Search, Upload, type LucideIcon } from "lucide-react";
import type { LibraryComponent } from "../../../core/contracts/modules/sdk";

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
  query: string,
): string | null {
  if (!backendURL) {
    return null;
  }

  const url = new URL(`${backendURL}/api/modules/library/components`);
  const trimmed = query.trim();
  if (trimmed.length > 0) {
    url.searchParams.set("q", trimmed);
  }
  url.searchParams.set("limit", "60");
  return url.toString();
}

function compactToken(id: string): string {
  return id
    .replace(/^(sym|fp|comp)-/i, "")
    .replace(/-/g, " ")
    .trim();
}

const SYMBOL_GLYPHS: Array<[RegExp, string]> = [
  [/(^|[-_/])ground($|[-_/])/, "GND"],
  [/(^|[-_/])vcc($|[-_/])/, "VCC"],
  [/(^|[-_/])resistor($|[-_/])/, "R"],
  [/(^|[-_/])capacitor($|[-_/])/, "C"],
  [/(^|[-_/])inductor($|[-_/])/, "L"],
];

function previewGlyph(component: LibraryComponent): string {
  const symbol = component.symbolId.toLowerCase();
  for (const [pattern, glyph] of SYMBOL_GLYPHS) {
    if (pattern.test(symbol)) {
      return glyph;
    }
  }

  const fallback = component.name.trim().charAt(0).toUpperCase();
  return fallback.length > 0 ? fallback : "U";
}

const MOUNT_TAGS = new Set(["smd", "through-hole", "tht", "virtual"]);

function cardChips(component: LibraryComponent): string[] {
  const chips: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const value = raw.trim();
    if (value.length === 0) {
      return;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    chips.push(value);
  };

  const packageTag = component.tags.find((tag) => /^\d{4}$/.test(tag));
  if (packageTag) {
    push(packageTag);
  }
  const mountTag = component.tags.find((tag) =>
    MOUNT_TAGS.has(tag.toLowerCase()),
  );
  if (mountTag) {
    push(mountTag);
  }
  push(compactToken(component.footprintId));

  return chips.slice(0, 2);
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

function LibraryCard({
  component,
}: {
  component: LibraryComponent;
}): ReactElement {
  const glyph = previewGlyph(component);
  const chips = cardChips(component);

  return (
    <article className="group relative flex h-56 w-full flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition-all hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700">
      {/* Checkbox - disabled */}
      <div className="absolute left-3 top-3 z-10">
        <input
          type="checkbox"
          disabled
          title="Coming soon"
          className="h-4 w-4 cursor-not-allowed rounded border-slate-300 text-violet-600 focus:ring-violet-600 dark:border-slate-600 dark:bg-slate-950 opacity-50"
          onClick={(e) => e.stopPropagation()}
        />
      </div>

      {/* Built-in Badge */}
      <div className="absolute right-3 top-3 z-10">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          Built-in
        </span>
      </div>

      {/* Preview Area - Compact */}
      <div className="relative flex h-22 items-center justify-center border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-800/40">
        <span className="text-3xl font-semibold tracking-tight text-slate-400 dark:text-slate-500">
          {glyph}
        </span>
      </div>

      {/* Content Area */}
      <div className="flex min-h-0 flex-1 flex-col p-3">
        <h3 className="truncate text-sm font-semibold leading-tight text-slate-900 dark:text-slate-100">
          {component.name}
        </h3>
        <p className="mt-1 line-clamp-2 text-xs leading-snug text-slate-500 dark:text-slate-400">
          {component.description || "No description"}
        </p>

        {/* Chips */}
        <div className="mt-auto flex flex-wrap items-center gap-1 pt-2">
          {chips.map((chip) => (
            <span
              key={`${component.id}-${chip}`}
              className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[0.6875rem] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400"
            >
              {chip}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}

export function LibrarySpace({ backendURL }: ModuleSpaceProps): ReactElement {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 180);
  const [components, setComponents] = useState<LibraryComponent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchUrl = useMemo(
    () => buildSearchUrl(backendURL, debouncedQuery),
    [backendURL, debouncedQuery],
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
  }, [searchUrl]);

  return (
    <div className="flex h-full w-full flex-col bg-slate-50 dark:bg-slate-950">
      {/* Header */}
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
            disabled
            title="Coming soon"
          />
          <ActionButton
            icon={Upload}
            label="Import"
            disabled
            title="Coming soon"
          />
        </div>
      </header>

      {/* Filter Bar */}
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

        <label
          className="flex select-none items-center gap-2 text-xs text-slate-400 dark:text-slate-500 cursor-not-allowed"
          title="Coming soon"
        >
          <input
            type="checkbox"
            disabled
            className="h-4 w-4 cursor-not-allowed rounded border-slate-300 text-violet-600 focus:ring-violet-600 dark:border-slate-600 opacity-50"
          />
          <span>Select All</span>
        </label>
      </div>

      {/* Main Content */}
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
                Try adjusting your filters or search query.
              </p>
            </div>
          )}

          {!loading && !error && components.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-5">
              {components.map((component) => (
                <LibraryCard key={component.id} component={component} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
