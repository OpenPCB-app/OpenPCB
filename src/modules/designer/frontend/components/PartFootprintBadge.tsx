import { useEffect, useRef, useState, type ReactElement } from "react";
import { ChevronDown, Layers } from "lucide-react";
import type { LibraryComponentFootprintVariant } from "../../../../sdks";

interface PartFootprintBadgeProps {
  partReference: string;
  componentName: string;
  currentFootprintId: string;
  variants: readonly LibraryComponentFootprintVariant[];
  onSelectVariant?: (footprintId: string) => void;
  /** Optional message shown in place of a working action when per-instance override is not yet supported. */
  disabledMessage?: string | null;
}

/**
 * Selection overlay surfaced next to a selected part. Shows the part's current
 * footprint variant and exposes a quick-change dropdown for components that
 * declare more than one footprint.
 *
 * Note: today this component is read-with-affordance. Per-instance footprint
 * override is queued for the next designer phase (see ComponentDetailPage
 * footprint-variants block). When the backend command lands, drop
 * `disabledMessage` and wire `onSelectVariant`.
 */
export function PartFootprintBadge({
  partReference,
  componentName,
  currentFootprintId,
  variants,
  onSelectVariant,
  disabledMessage,
}: PartFootprintBadgeProps): ReactElement | null {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current) return;
      if (!(event.target instanceof Node)) return;
      if (!wrapperRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [open]);

  if (variants.length === 0) return null;

  const current =
    variants.find((variant) => variant.footprintId === currentFootprintId) ??
    variants.find((variant) => variant.isDefault) ??
    variants[0];
  if (!current) return null;

  const hasAlternatives = variants.length > 1;
  const disabled = Boolean(disabledMessage);

  return (
    <div
      ref={wrapperRef}
      className="pointer-events-auto absolute right-4 top-4 z-40 min-w-[16rem] rounded-xl border border-slate-700 bg-slate-900/95 px-3 py-2 text-xs text-slate-100 shadow-xl backdrop-blur"
      data-testid="part-footprint-badge"
    >
      <div className="flex items-center gap-2">
        <Layers className="h-3.5 w-3.5 text-violet-300" />
        <span className="font-semibold tracking-tight">{partReference}</span>
        <span className="truncate text-[11px] text-slate-400">
          {componentName}
        </span>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          Footprint
        </span>
        {hasAlternatives ? (
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] font-medium text-slate-100 hover:bg-slate-700"
          >
            <span className="max-w-[10rem] truncate">
              {current.variantLabel}
            </span>
            <ChevronDown className="h-3 w-3 text-slate-400" />
          </button>
        ) : (
          <span className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300">
            {current.variantLabel}
          </span>
        )}
      </div>
      {open && hasAlternatives && (
        <ul
          role="listbox"
          className="mt-2 max-h-60 overflow-y-auto rounded-md border border-slate-700 bg-slate-900 py-1"
        >
          {variants
            .slice()
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((variant) => {
              const active = variant.footprintId === current.footprintId;
              return (
                <li key={variant.footprintId}>
                  <button
                    type="button"
                    disabled={disabled || active}
                    onClick={() => {
                      if (active || disabled) return;
                      onSelectVariant?.(variant.footprintId);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[11px] transition-colors ${
                      active
                        ? "bg-violet-950/60 text-violet-200"
                        : disabled
                          ? "cursor-not-allowed text-slate-500"
                          : "text-slate-200 hover:bg-slate-800"
                    }`}
                  >
                    <span className="flex flex-col">
                      <span className="font-medium">
                        {variant.variantLabel}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {variant.mountType ?? "—"} · {variant.padCount} pads
                      </span>
                    </span>
                    {variant.isDefault && (
                      <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                        Default
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
        </ul>
      )}
      {disabled && (
        <p className="mt-2 text-[10px] leading-snug text-amber-300/80">
          {disabledMessage}
        </p>
      )}
    </div>
  );
}
