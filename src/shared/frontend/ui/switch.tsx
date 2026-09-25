import * as React from "react";
import { cn } from "@/lib/utils";
import { FOCUS_RING_OUTSET, type ControlSize } from "./focus";

export interface SwitchProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "onChange" | "role" | "aria-checked" | "children"
  > {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Visible label to the right; clicking it toggles too. */
  label?: React.ReactNode;
  /** Row height of the labelled switch: `md` 22px (default), `sm` 20px. */
  size?: ControlSize;
}

const TRACK: Record<ControlSize, string> = {
  md: "h-3.5 w-6",
  sm: "h-3 w-5",
};

const THUMB: Record<ControlSize, { base: string; on: string }> = {
  md: { base: "h-2.5 w-2.5", on: "translate-x-2.5" },
  sm: { base: "h-2 w-2", on: "translate-x-2" },
};

/** On/off toggle: `<button role="switch" aria-checked>`; on = primary fill. */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  (
    { checked, onCheckedChange, label, size = "md", disabled, className, onClick, ...props },
    ref,
  ) => {
    const button = (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) onCheckedChange(!checked);
        }}
        className={cn(
          "relative inline-flex shrink-0 items-center rounded-control border p-px transition-colors",
          FOCUS_RING_OUTSET,
          "disabled:cursor-not-allowed disabled:opacity-50",
          TRACK[size],
          checked
            ? "border-primary bg-primary"
            : "border-border-control bg-surface-control",
          label === undefined && className,
        )}
        {...props}
      >
        <span
          aria-hidden="true"
          className={cn(
            "block rounded-[1px] transition-transform motion-reduce:transition-none",
            THUMB[size].base,
            checked
              ? cn("bg-primary-foreground", THUMB[size].on)
              : "translate-x-0 bg-text-secondary",
          )}
        />
      </button>
    );
    if (label === undefined) return button;
    return (
      <label
        className={cn(
          "inline-flex select-none items-center gap-2 text-xs text-text",
          size === "sm" ? "h-5" : "h-[22px]",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
          className,
        )}
      >
        {button}
        <span className="min-w-0 truncate">{label}</span>
      </label>
    );
  },
);
Switch.displayName = "Switch";
