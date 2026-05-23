import { useState, type DragEvent, type ReactElement } from "react";
import type { LibraryComponent } from "../../../sdks/library";
import { useTheme } from "../../../core/frontend/src/providers/ThemeProvider";

export const DRAG_MIME_TYPE = "application/x-openpcb-library-component";

interface LibraryCardProps {
  component: LibraryComponent;
  moduleId: string;
  backendURL?: string | null;
  selected?: boolean;
  onOpen: (componentId: string) => void;
  onToggleSelect?: (componentId: string) => void;
  onPlace?: (componentId: string) => void;
}

export function LibraryCard({
  component,
  moduleId,
  backendURL,
  selected,
  onOpen,
  onToggleSelect,
  onPlace,
}: LibraryCardProps): ReactElement {
  const [previewFailed, setPreviewFailed] = useState(false);
  const { mode } = useTheme();
  const hasPlaceholderFootprint = component.tags.some(
    (t) => t.trim().toLowerCase() === "placeholder-footprint",
  );
  const isBuiltin = component.isBuiltin;
  const previewUrl = backendURL
    ? `${backendURL}/api/modules/${moduleId}/symbols/${encodeURIComponent(component.symbolId)}/preview.svg?theme=${mode}`
    : null;

  const borderClass = selected
    ? "border-violet-500 dark:border-violet-500"
    : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700";

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    const payload = JSON.stringify({
      componentId: component.id,
      symbolId: component.symbolId,
      footprintId: component.footprintId,
      name: component.name,
    });
    event.dataTransfer.setData(DRAG_MIME_TYPE, payload);
    event.dataTransfer.setData("text/plain", component.name);
    event.dataTransfer.effectAllowed = "copy";
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      className={`group relative flex h-56 w-full flex-col overflow-hidden rounded-xl border bg-white text-left transition-all hover:shadow-sm dark:bg-slate-900 ${borderClass}`}
      data-testid={`library-component-card-${component.id}`}
    >
      {!isBuiltin && (
        <label className="absolute left-2 top-2 z-10 inline-flex items-center rounded-sm bg-white/90 p-0.5 dark:bg-slate-900/90">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect?.(component.id)}
            onClick={(event) => event.stopPropagation()}
            aria-label={`Select ${component.name}`}
            className="h-4 w-4 cursor-pointer rounded border-slate-300 text-violet-600 focus:ring-violet-600 dark:border-slate-600"
          />
        </label>
      )}
      {isBuiltin && (
        <span
          className="absolute right-2 top-2 z-10 inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-[0.6rem] font-semibold uppercase tracking-wider text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"
          title="Built-in component — read-only. Use Duplicate to edit."
        >
          Core
        </span>
      )}
      <button
        type="button"
        onClick={() => onOpen(component.id)}
        className="flex h-full w-full flex-col text-left focus:outline-none focus:ring-2 focus:ring-violet-500"
      >
        <div className="relative flex h-28 items-center justify-center border-b border-slate-200 bg-slate-50 px-4 dark:border-slate-800 dark:bg-slate-800/40">
          {previewUrl && !previewFailed ? (
            <img
              src={previewUrl}
              alt=""
              draggable={false}
              loading="lazy"
              decoding="async"
              onError={() => setPreviewFailed(true)}
              className="h-full w-full object-contain text-slate-700 dark:text-slate-200"
            />
          ) : (
            <PreviewFallback name={component.name} />
          )}
          {onPlace && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onPlace(component.id);
              }}
              className="absolute bottom-1.5 right-1.5 hidden items-center gap-1 rounded-md bg-violet-600 px-2 py-1 text-[0.6875rem] font-medium text-white shadow-sm transition-opacity hover:bg-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-500 group-hover:inline-flex"
              aria-label={`Place ${component.name}`}
            >
              Place
            </button>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-3">
          <h3 className="truncate text-sm font-semibold leading-tight text-slate-900 dark:text-slate-100">
            {component.name}
          </h3>
          <p className="mt-1 line-clamp-2 text-xs leading-snug text-slate-500 dark:text-slate-400">
            {component.description || "No description"}
          </p>
          {hasPlaceholderFootprint && (
            <div className="mt-auto flex flex-wrap items-center gap-1 pt-2">
              <span
                className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[0.6875rem] font-medium text-violet-700 dark:border-violet-900 dark:bg-violet-950/60 dark:text-violet-300"
                title="Component imported without a footprint"
              >
                No footprint
              </span>
            </div>
          )}
        </div>
      </button>
    </div>
  );
}

function PreviewFallback({ name }: { name: string }): ReactElement {
  const glyph = name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      aria-hidden
      className="text-3xl font-semibold tracking-tight text-slate-300 dark:text-slate-600"
    >
      {glyph}
    </span>
  );
}
