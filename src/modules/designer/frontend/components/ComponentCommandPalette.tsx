import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { Search } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { LibraryComponent } from "../../../../sdks";

interface ComponentCommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (componentId: string) => void;
  searchComponents: (query: string) => Promise<LibraryComponent[]>;
  loadDefaultComponents: () => Promise<{
    label: string;
    components: LibraryComponent[];
  }>;
}

export function ComponentCommandPalette({
  open,
  onOpenChange,
  onSelect,
  searchComponents,
  loadDefaultComponents,
}: ComponentCommandPaletteProps): ReactElement {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LibraryComponent[]>([]);
  const [resultsLabel, setResultsLabel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      setResultsLabel(null);
      setHighlightedIndex(0);
      return;
    }

    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 10);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    const trimmed = query.trim();
    setLoading(true);

    if (trimmed.length === 0) {
      const timer = window.setTimeout(() => {
        loadDefaultComponents()
          .then((defaults) => {
            if (controller.signal.aborted) return;
            setResults(defaults.components);
            setResultsLabel(defaults.label);
            setHighlightedIndex(0);
          })
          .catch(() => {
            if (controller.signal.aborted) return;
            setResults([]);
            setResultsLabel(null);
            setHighlightedIndex(0);
          })
          .finally(() => {
            if (!controller.signal.aborted) {
              setLoading(false);
            }
          });
      }, 80);

      return () => {
        window.clearTimeout(timer);
        controller.abort();
      };
    }

    setResultsLabel(null);
    const timer = window.setTimeout(() => {
      searchComponents(trimmed)
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
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        });
    }, 160);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, searchComponents, loadDefaultComponents]);

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
        if (selected) {
          onSelect(selected.id);
        }
        return;
      }
      if (event.key === "Escape") {
        onOpenChange(false);
        return;
      }
    },
    [highlightedIndex, results, onSelect, onOpenChange],
  );

  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  useEffect(() => {
    const el = itemRefs.current[highlightedIndex];
    if (el && listRef.current) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[15vh] z-50 w-[min(640px,92vw)] -translate-x-1/2 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
          onPointerDownOutside={() => onOpenChange(false)}
          onEscapeKeyDown={() => onOpenChange(false)}
        >
          <DialogPrimitive.Title className="sr-only">
            Place component
          </DialogPrimitive.Title>
          <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search component..."
              className="w-full bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
            />
            <kbd className="hidden rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 sm:inline-block">
              ESC
            </kbd>
          </div>

          <ul
            ref={listRef}
            className="max-h-[min(50vh,360px)] overflow-y-auto py-2"
          >
            {results.length === 0 && !loading && query.trim().length > 0 && (
              <li className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                No components found
              </li>
            )}
            {resultsLabel && results.length > 0 ? (
              <li className="px-4 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {resultsLabel}
              </li>
            ) : null}
            {results.length === 0 && !loading && query.trim().length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                No components available
              </li>
            )}
            {results.map((component, index) => {
              const active = index === highlightedIndex;
              return (
                <li
                  key={component.id}
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                >
                  <button
                    type="button"
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onClick={() => onSelect(component.id)}
                    className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
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
                        {component.isBuiltin ? (
                          <span className="inline-flex shrink-0 items-center rounded-full bg-violet-100 px-1.5 text-[0.6rem] font-semibold uppercase tracking-wider text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
                            Core
                          </span>
                        ) : null}
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
            })}
            {loading && (
              <li className="px-4 py-3 text-xs text-slate-400 dark:text-slate-500">
                Searching...
              </li>
            )}
          </ul>

          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-[11px] text-slate-400 dark:border-slate-700 dark:text-slate-500">
            <span>
              {results.length} result{results.length !== 1 ? "s" : ""}
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
              to select
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
