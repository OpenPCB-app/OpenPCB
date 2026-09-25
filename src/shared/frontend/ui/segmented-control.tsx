import * as React from "react";
import { cn } from "@/lib/utils";
import { FOCUS_RING } from "./focus";
import { nextRovingIndex } from "./roving";

export interface SegmentedOption<T> {
  id: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Native tooltip; falls back to the label when it is a string. */
  title?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T> {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (id: T) => void;
  /** `sm` = 20px (parameter row), `md` = 22px (default). */
  size?: "sm" | "md";
  className?: string;
  optionClassName?: string;
  "aria-label"?: string;
}

/**
 * Flat segmented toggle (design D2 §5, design D3 §5). Toggle buttons
 * (`aria-pressed`) with one Tab stop: Arrow Left/Right + Home/End move focus,
 * Enter/Space select — the WAI-ARIA toolbar pattern (T-018).
 */
export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  size = "md",
  className,
  optionClassName,
  "aria-label": ariaLabel,
}: SegmentedControlProps<T>) {
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const [focusIndex, setFocusIndex] = React.useState<number | null>(null);
  const activeIndex = options.findIndex((option) => option.id === value);
  const restingStop =
    activeIndex >= 0 && !options[activeIndex]?.disabled
      ? activeIndex
      : options.findIndex((option) => !option.disabled);
  const tabStop = focusIndex ?? restingStop;

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = nextRovingIndex({
      key: event.key,
      current: index,
      count: options.length,
      isDisabled: (i) => Boolean(options[i]?.disabled),
    });
    if (next === null) return;
    event.preventDefault();
    setFocusIndex(next);
    optionRefs.current[next]?.focus();
  };

  const onBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setFocusIndex(null);
    }
  };

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      // Tells isShortcutBlocked that arrow/Home/End belong to this group.
      data-roving-focus=""
      onBlur={onBlur}
      className={cn(
        "inline-flex shrink-0 items-stretch overflow-hidden rounded-control border border-border-control",
        size === "sm" ? "h-[20px]" : "h-[22px]",
        className,
      )}
    >
      {options.map((option, index) => {
        const active = option.id === value;
        return (
          <button
            key={String(option.id)}
            ref={(node) => {
              optionRefs.current[index] = node;
            }}
            type="button"
            disabled={option.disabled}
            aria-pressed={active}
            tabIndex={index === tabStop ? 0 : -1}
            title={
              option.title ??
              (typeof option.label === "string" ? option.label : undefined)
            }
            onClick={() => onChange(option.id)}
            onFocus={() => setFocusIndex(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              "inline-flex items-center gap-1 px-2 text-2xs whitespace-nowrap transition-colors",
              FOCUS_RING,
              "disabled:cursor-not-allowed disabled:opacity-50",
              "[&_svg]:h-3 [&_svg]:w-3 [&_svg]:shrink-0",
              active
                ? "bg-surface-control font-medium text-text-strong"
                : "text-text-secondary hover:bg-surface-hover hover:text-text",
              optionClassName,
            )}
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
