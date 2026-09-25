import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CONTROL_HEIGHT,
  FIELD_BASE,
  FIELD_FOCUS,
  FIELD_INVALID,
  type ControlSize,
} from "./focus";

export interface SelectOption<T extends string> {
  id: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string>
  extends Omit<
    React.SelectHTMLAttributes<HTMLSelectElement>,
    "value" | "defaultValue" | "onChange" | "size" | "children" | "multiple"
  > {
  options: ReadonlyArray<SelectOption<T>>;
  value: T;
  onChange: (id: T) => void;
  /** `md` 22px (default), `sm` 20px. */
  size?: ControlSize;
  invalid?: boolean;
  /** Shown (disabled) while `value` matches no option, e.g. "Choose…". */
  placeholder?: string;
  /** Class for the wrapper that carries width/layout. */
  containerClassName?: string;
}

function SelectInner<T extends string>(
  {
    options,
    value,
    onChange,
    size = "md",
    invalid = false,
    placeholder,
    className,
    containerClassName,
    ...props
  }: SelectProps<T>,
  ref: React.ForwardedRef<HTMLSelectElement>,
) {
  const known = options.some((option) => option.id === value);
  return (
    <span className={cn("relative inline-flex min-w-0", containerClassName)}>
      <select
        ref={ref}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value as T)}
        className={cn(
          "w-full min-w-0 cursor-pointer appearance-none pl-1.5 pr-5",
          FIELD_BASE,
          FIELD_FOCUS,
          CONTROL_HEIGHT[size],
          "[&>option]:bg-surface-input [&>option]:text-text-strong",
          invalid && FIELD_INVALID,
          className,
        )}
        {...props}
      >
        {!known ? (
          <option value={value} disabled hidden>
            {placeholder ?? ""}
          </option>
        ) : null}
        {options.map((option) => (
          <option key={option.id} value={option.id} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        strokeWidth={1.5}
        className="pointer-events-none absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 text-text-tertiary"
      />
    </span>
  );
}

/**
 * Styled NATIVE `<select>` (works inside canvases and Electron; the global
 * `color-scheme` gives the popup the theme). Generic over the option ids.
 */
export const Select = React.forwardRef(SelectInner) as <T extends string>(
  props: SelectProps<T> & { ref?: React.Ref<HTMLSelectElement> },
) => React.ReactElement;
