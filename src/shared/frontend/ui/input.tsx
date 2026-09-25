import * as React from "react";
import { cn } from "@/lib/utils";
import {
  CONTROL_HEIGHT,
  FIELD_BASE,
  FIELD_FOCUS,
  FIELD_FOCUS_WITHIN,
  FIELD_INVALID,
  type ControlSize,
} from "./focus";

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  /** `md` 22px (default), `sm` 20px. */
  size?: ControlSize;
  /** Danger border + `aria-invalid`. */
  invalid?: boolean;
  /** Mono face for identifiers, coordinates and numbers. */
  mono?: boolean;
  /** Adornment before the text (icon, prefix). */
  leading?: React.ReactNode;
  /** Adornment after the text (unit suffix such as "mm"). */
  trailing?: React.ReactNode;
  /**
   * Class for the visible box when `leading`/`trailing` is set (put widths
   * here); without adornments the input is the box and takes `className`.
   */
  containerClassName?: string;
}

/** 22px text field (kit replacement for hand-rolled `<input>`). */
export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      size = "md",
      invalid = false,
      mono = false,
      leading,
      trailing,
      containerClassName,
      className,
      type = "text",
      ...props
    },
    ref,
  ) => {
    const hasAdornment = leading != null || trailing != null;
    if (!hasAdornment) {
      return (
        <input
          ref={ref}
          type={type}
          aria-invalid={invalid || undefined}
          className={cn(
            "w-full min-w-0 px-1.5",
            FIELD_BASE,
            FIELD_FOCUS,
            CONTROL_HEIGHT[size],
            mono && "font-mono",
            invalid && FIELD_INVALID,
            className,
          )}
          {...props}
        />
      );
    }
    return (
      <div
        className={cn(
          "flex w-full min-w-0 items-center gap-1 px-1.5",
          FIELD_BASE,
          FIELD_FOCUS_WITHIN,
          CONTROL_HEIGHT[size],
          invalid && FIELD_INVALID,
          props.disabled && "cursor-not-allowed opacity-50",
          containerClassName,
        )}
      >
        {leading != null ? (
          <span className="flex shrink-0 items-center text-text-tertiary [&_svg]:h-3 [&_svg]:w-3">
            {leading}
          </span>
        ) : null}
        <input
          ref={ref}
          type={type}
          aria-invalid={invalid || undefined}
          className={cn(
            "h-full min-w-0 flex-1 bg-transparent text-xs text-text-strong outline-none",
            "placeholder:text-text-disabled disabled:cursor-not-allowed",
            mono && "font-mono",
            className,
          )}
          {...props}
        />
        {trailing != null ? (
          <span className="shrink-0 font-mono text-2xs text-text-tertiary">{trailing}</span>
        ) : null}
      </div>
    );
  },
);
Input.displayName = "Input";
