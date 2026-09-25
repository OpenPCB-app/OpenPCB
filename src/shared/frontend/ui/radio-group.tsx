import * as React from "react";
import { cn } from "@/lib/utils";

export interface RadioOption<T extends string> {
  id: T;
  label: React.ReactNode;
  /** Muted second line under the label. */
  description?: React.ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps<T extends string> {
  options: ReadonlyArray<RadioOption<T>>;
  value: T;
  onChange: (id: T) => void;
  /** Native radio `name` — groups the inputs (arrow keys, one Tab stop). */
  name: string;
  orientation?: "vertical" | "horizontal";
  "aria-label"?: string;
  "aria-labelledby"?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Single choice from a short list. Real `<input type="radio">`s (visually
 * hidden) give the WAI-ARIA radio keyboard model natively.
 */
export function RadioGroup<T extends string>({
  options,
  value,
  onChange,
  name,
  orientation = "vertical",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  disabled = false,
  className,
}: RadioGroupProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      aria-orientation={orientation}
      className={cn(
        "flex",
        orientation === "vertical" ? "flex-col gap-0.5" : "flex-row flex-wrap gap-x-3",
        className,
      )}
    >
      {options.map((option) => {
        const checked = option.id === value;
        const isDisabled = disabled || Boolean(option.disabled);
        return (
          <label
            key={option.id}
            className={cn(
              "flex min-h-[22px] select-none items-start gap-1.5 py-[5px] text-xs text-text",
              isDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
            )}
          >
            <input
              type="radio"
              className="peer sr-only"
              name={name}
              value={option.id}
              checked={checked}
              disabled={isDisabled}
              onChange={() => onChange(option.id)}
            />
            <span
              aria-hidden="true"
              className={cn(
                "mt-px flex h-[11px] w-[11px] shrink-0 items-center justify-center rounded-full border bg-surface-input",
                checked ? "border-text-strong" : "border-text-caps",
                "peer-focus-visible:outline-solid peer-focus-visible:outline-1 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-focus-ring",
              )}
            >
              {checked ? <span className="h-[5px] w-[5px] rounded-full bg-text-strong" /> : null}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="leading-3">{option.label}</span>
              {option.description ? (
                <span className="mt-0.5 text-2xs text-text-tertiary">{option.description}</span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
