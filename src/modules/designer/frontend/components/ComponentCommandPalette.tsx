import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { Search } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type {
  LibraryComponent,
  LibraryComponentPlacementDetail,
  LibraryTagStat,
} from "../../../../sdks";
import type { SymbolRenderModel } from "../../../../shared/rendering/types";
import { SymbolPreviewCanvas } from "../../../../shared/frontend/canvas/preview";
import { TagFilterChips } from "../../../library/frontend/components/TagFilterChips";
import { groupTags } from "../../../library/frontend/tag-grouping";

interface PaletteSection {
  label: string;
  components: LibraryComponent[];
}

interface ComponentCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (componentId: string) => void;
  searchComponents: (
    query: string,
    tags?: readonly string[],
  ) => Promise<LibraryComponent[]>;
  loadDefaultComponents: () => Promise<{
    groups: PaletteSection[];
  }>;
  fetchPlacementDetail: (
    componentId: string,
  ) => Promise<LibraryComponentPlacementDetail>;
  fetchAvailableTags: () => Promise<LibraryTagStat[]>;
}

function asSymbolPreview(value: unknown): SymbolRenderModel | null {
  if (!value || typeof value !== "object") return null;
  if ((value as { kind?: unknown }).kind !== "symbol") return null;
  return value as SymbolRenderModel;
}

export function ComponentCommandPalette({
  open,
  onOpenChange,
  onSelect,
  searchComponents,
  loadDefaultComponents,
  fetchPlacementDetail,
  fetchAvailableTags,
}: ComponentCommandPaletteProps): ReactElement {
  const [query, setQuery] = useState("");
  const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<LibraryComponent[]>([]);
  const [sections, setSections] = useState<PaletteSection[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [availableTags, setAvailableTags] = useState<LibraryTagStat[]>([]);
  const [previewDetail, setPreviewDetail] =
    useState<LibraryComponentPlacementDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const previewAbortRef = useRef<AbortController | null>(null);
  const detailCacheRef = useRef(
    new Map<string, LibraryComponentPlacementDetail>(),
  );

  // Focus + reset when opened
  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveTags(new Set());
      setResults([]);
      setSections([]);
      setHighlightedIndex(0);
      setPreviewDetail(null);
      setPreviewLoading(false);
      return;
    }
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 10);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Tag chips: fetched once per open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchAvailableTags()
      .then((tags) => {
        if (cancelled) return;
        setAvailableTags(tags);
      })
      .catch(() => {
        if (cancelled) return;
        setAvailableTags([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, fetchAvailableTags]);

  const tagsKey = useMemo(() => [...activeTags].sort().join(","), [activeTags]);

  // Search debounce + tag awareness
  useEffect(() => {
    if (!open) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const trimmed = query.trim();
    const activeTagList =
      tagsKey.length > 0 ? tagsKey.split(",") : ([] as string[]);
    setLoading(true);

    if (trimmed.length === 0 && activeTagList.length === 0) {
      const timer = window.setTimeout(() => {
        loadDefaultComponents()
          .then((defaults) => {
            if (controller.signal.aborted) return;
            const flat = defaults.groups.flatMap((g) => g.components);
            setSections(defaults.groups);
            setResults(flat);
            setHighlightedIndex(0);
          })
          .catch(() => {
            if (controller.signal.aborted) return;
            setSections([]);
            setResults([]);
            setHighlightedIndex(0);
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      }, 80);
      return () => {
        window.clearTimeout(timer);
        controller.abort();
      };
    }

    setSections([]);
    const timer = window.setTimeout(() => {
      searchComponents(trimmed, activeTagList)
        .then((found) => {
          if (controller.signal.aborted) return;
          setResults(found);
          setHighlightedIndex(0);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setResults([]);
          setHighlightedIndex(0);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 160);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, tagsKey, searchComponents, loadDefaultComponents]);

  // Preview loader (debounced, cached)
  const highlighted = results[highlightedIndex] ?? null;
  useEffect(() => {
    if (!open || !highlighted) {
      setPreviewDetail(null);
      setPreviewLoading(false);
      return;
    }

    const cached = detailCacheRef.current.get(highlighted.id);
    if (cached) {
      setPreviewDetail(cached);
      setPreviewLoading(false);
      return;
    }

    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    setPreviewLoading(true);

    const timer = window.setTimeout(() => {
      fetchPlacementDetail(highlighted.id)
        .then((detail) => {
          if (controller.signal.aborted) return;
          detailCacheRef.current.set(highlighted.id, detail);
          setPreviewDetail(detail);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setPreviewDetail(null);
        })
        .finally(() => {
          if (!controller.signal.aborted) setPreviewLoading(false);
        });
    }, 150);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, highlighted, fetchPlacementDetail]);

  const tagGroups = useMemo(
    () => groupTags(availableTags, { excludeSystem: true, dropEmpty: true }),
    [availableTags],
  );

  const toggleTag = useCallback((tag: string) => {
    setActiveTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setHighlightedIndex((prev) =>
          Math.min(prev + 1, Math.max(0, results.length - 1)),
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setHighlightedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const selected = results[highlightedIndex];
        if (selected) onSelect(selected.id);
        return;
      }
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    },
    [highlightedIndex, results, onSelect, onOpenChange],
  );

  useEffect(() => {
    const el = itemRefs.current[highlightedIndex];
    if (el && listRef.current) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  const symbolPreview = useMemo(
    () => asSymbolPreview(previewDetail?.symbol.preview),
    [previewDetail],
  );

  const previewMeta = useMemo(() => {
    if (!previewDetail) return null;
    return {
      symbolName: previewDetail.symbol.name,
      referencePrefix: previewDetail.symbol.referencePrefix ?? "—",
      pinCount: previewDetail.symbol.pins.length,
      footprintName: previewDetail.footprint.name,
      mountType: previewDetail.footprint.mountType ?? "—",
      variantCount: previewDetail.footprintVariants.length,
    };
  }, [previewDetail]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[12vh] z-50 flex max-h-[80vh] w-[min(860px,94vw)] -translate-x-1/2 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          onPointerDownOutside={() => onOpenChange(false)}
          onEscapeKeyDown={() => onOpenChange(false)}
        >
          <DialogPrimitive.Title className="sr-only">
            Place component
          </DialogPrimitive.Title>

          {/* Search bar */}
          <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search component by name, description, or tag…"
              className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
            />
            <kbd className="hidden rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 sm:inline-block">
              ESC
            </kbd>
          </div>

          {/* Tag filter chips */}
          {tagGroups.length > 0 && (
            <div className="max-h-32 overflow-y-auto border-b border-slate-200 px-4 py-2 dark:border-slate-700">
              <TagFilterChips
                groups={tagGroups}
                active={activeTags}
                onToggle={toggleTag}
                onClear={() => setActiveTags(new Set())}
              />
            </div>
          )}

          {/* Body: split panel */}
          <div className="flex min-h-0 flex-1">
            <ul
              ref={listRef}
              className="flex-1 overflow-y-auto py-2"
              data-testid="palette-results-list"
            >
              {results.length === 0 && !loading && (
                <li className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                  {query.trim().length > 0 || activeTags.size > 0
                    ? "No components match"
                    : "No components available"}
                </li>
              )}
              {(() => {
                if (results.length === 0) return null;
                // When sections are present (empty query, no tag filter), render
                // each group with its label header. Otherwise render flat.
                const useSections =
                  sections.length > 0 &&
                  query.trim().length === 0 &&
                  activeTags.size === 0;
                const renderItem = (
                  component: LibraryComponent,
                  flatIndex: number,
                ) => {
                  const active = flatIndex === highlightedIndex;
                  const packageTag =
                    component.tags.find((t) => /^\d{4}$/.test(t)) ?? null;
                  const mountTag =
                    component.tags.find((t) =>
                      ["smd", "tht", "through-hole", "smt"].includes(
                        t.toLowerCase(),
                      ),
                    ) ?? null;
                  return (
                    <li
                      key={component.id}
                      ref={(el) => {
                        itemRefs.current[flatIndex] = el;
                      }}
                    >
                      <button
                        type="button"
                        onMouseEnter={() => setHighlightedIndex(flatIndex)}
                        onClick={() => onSelect(component.id)}
                        className={`flex w-full items-center gap-2 px-4 py-2 text-left transition-colors ${
                          active
                            ? "bg-violet-50 dark:bg-violet-950/40"
                            : "hover:bg-slate-50 dark:hover:bg-slate-800/60"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                              {component.name}
                            </span>
                            {component.isBuiltin && (
                              <span className="inline-flex shrink-0 items-center rounded-full bg-violet-100 px-1.5 text-[0.6rem] font-semibold uppercase tracking-wider text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                                Core
                              </span>
                            )}
                            {packageTag && (
                              <span className="inline-flex shrink-0 items-center rounded-full bg-slate-100 px-1.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                {packageTag}
                              </span>
                            )}
                            {mountTag && (
                              <span className="inline-flex shrink-0 items-center rounded-full bg-slate-100 px-1.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                                {mountTag}
                              </span>
                            )}
                          </div>
                          <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                            {component.description || component.id}
                          </span>
                        </div>
                        {active && (
                          <kbd className="hidden shrink-0 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 sm:inline-block">
                            ENTER
                          </kbd>
                        )}
                      </button>
                    </li>
                  );
                };

                if (useSections) {
                  let cursor = 0;
                  return sections.map((section) => {
                    const start = cursor;
                    const block = (
                      <ul key={section.label} className="contents">
                        <li className="px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                          {section.label}
                        </li>
                        {section.components.map((component) =>
                          renderItem(component, cursor++),
                        )}
                      </ul>
                    );
                    // start unused locally — only kept to make cursor advance order explicit
                    void start;
                    return block;
                  });
                }

                return results.map((component, index) =>
                  renderItem(component, index),
                );
              })()}
              {loading && (
                <li className="px-4 py-3 text-xs text-slate-400 dark:text-slate-500">
                  Searching…
                </li>
              )}
            </ul>

            {/* Preview panel */}
            <aside className="flex w-72 shrink-0 flex-col border-l border-slate-200 dark:border-slate-700">
              <div className="h-44 border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
                {previewLoading && !symbolPreview ? (
                  <div className="flex h-full items-center justify-center text-[11px] text-slate-400 dark:text-slate-500">
                    Loading preview…
                  </div>
                ) : symbolPreview ? (
                  <SymbolPreviewCanvas model={symbolPreview} />
                ) : (
                  <div className="flex h-full items-center justify-center text-[11px] text-slate-400 dark:text-slate-500">
                    {highlighted
                      ? "No preview available"
                      : "Select a component"}
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-3 text-xs text-slate-700 dark:text-slate-200">
                {highlighted ? (
                  <>
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {highlighted.name}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500 line-clamp-3 dark:text-slate-400">
                      {highlighted.description || "No description"}
                    </p>
                    {previewMeta && (
                      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
                        <dt className="text-slate-400 dark:text-slate-500">
                          Ref
                        </dt>
                        <dd className="text-slate-700 dark:text-slate-300">
                          {previewMeta.referencePrefix}
                        </dd>
                        <dt className="text-slate-400 dark:text-slate-500">
                          Pins
                        </dt>
                        <dd className="text-slate-700 dark:text-slate-300">
                          {previewMeta.pinCount}
                        </dd>
                        <dt className="text-slate-400 dark:text-slate-500">
                          Mount
                        </dt>
                        <dd className="text-slate-700 dark:text-slate-300">
                          {previewMeta.mountType}
                        </dd>
                        <dt className="text-slate-400 dark:text-slate-500">
                          Footprint
                        </dt>
                        <dd className="truncate text-slate-700 dark:text-slate-300">
                          {previewMeta.footprintName}
                          {previewMeta.variantCount > 1
                            ? ` (+${previewMeta.variantCount - 1} variants)`
                            : ""}
                        </dd>
                      </dl>
                    )}
                    {highlighted.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {highlighted.tags.slice(0, 8).map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">
                    Highlight a component to preview.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => highlighted && onSelect(highlighted.id)}
                disabled={!highlighted}
                className="mx-3 mb-3 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-violet-600 px-3 text-sm font-semibold text-white transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Place
                <kbd className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white/90">
                  ↵
                </kbd>
              </button>
            </aside>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-2 text-[11px] text-slate-400 dark:border-slate-700 dark:text-slate-500">
            <span>
              {results.length} result{results.length !== 1 ? "s" : ""}
              {activeTags.size > 0
                ? ` · ${activeTags.size} tag filter${activeTags.size === 1 ? "" : "s"}`
                : ""}
            </span>
            <span className="hidden sm:inline">
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 dark:border-slate-700 dark:bg-slate-800">
                ↑
              </kbd>{" "}
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 dark:border-slate-700 dark:bg-slate-800">
                ↓
              </kbd>{" "}
              to navigate{" "}
              <kbd className="rounded border border-slate-200 bg-slate-50 px-1 py-0.5 dark:border-slate-700 dark:bg-slate-800">
                enter
              </kbd>{" "}
              to place
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
