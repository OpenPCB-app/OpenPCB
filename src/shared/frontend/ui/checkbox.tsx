import * as React from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "size"> {
  label?: React.ReactNode;
  indeterminate?: boolean;
  /** Class applied to the 11×11 box. */
  boxClassName?: string;
  /** Class applied to the wrapping label element. */
  wrapperClassName?: string;
  /**
   * Row height of the wrapping label: `md` 22px, `sm` 20px. Omit to keep the
   * label's natural height (inline use inside an existing row).
   */
  size?: "sm" | "md";
}

/**
 * 11×11 square checkbox (design D2 §7 / D3 §5). Wraps a real
 * `<input type="checkbox">` (visually hidden) so keyboard + a11y behave.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  (
    {
      label,
      indeterminate = false,
      checked,
      defaultChecked,
      onChange,
      className,
      boxClassName,
      wrapperClassName,
      size,
      disabled,
      ...props
    },
    ref,
  ) => {
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    const [uncontrolled, setUncontrolled] = React.useState(!!defaultChecked);
    const isControlled = checked !== undefined;
    const isChecked = isControlled ? !!checked : uncontrolled;

    React.useEffect(() => {
      if (innerRef.current) innerRef.current.indeterminate = indeterminate;
    }, [indeterminate]);

    const setRefs = React.useCallback(
      (node: HTMLInputElement | null) => {
        innerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );

    return (
      <label
        className={cn(
          "inline-flex select-none items-center gap-1.5 text-xs text-text",
          size === "md" && "h-[22px]",
          size === "sm" && "h-5",
          disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
          wrapperClassName,
          className,
        )}
      >
        <input
          ref={setRefs}
          type="checkbox"
          className="peer sr-only"
          checked={isControlled ? !!checked : undefined}
          defaultChecked={isControlled ? undefined : defaultChecked}
          disabled={disabled}
          onChange={(event) => {
            if (!isControlled) setUncontrolled(event.currentTarget.checked);
            onChange?.(event);
          }}
          {...props}
        />
        <span
          aria-hidden="true"
          className={cn(
            "flex h-[11px] w-[11px] shrink-0 items-center justify-center rounded-none border border-text-caps bg-surface-input",
            "peer-focus-visible:border-selection peer-focus-visible:outline-solid peer-focus-visible:outline-1 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-focus-ring",
            boxClassName,
          )}
        >
          {indeterminate ? (
            <Minus className="h-[9px] w-[9px] text-text-strong" strokeWidth={2.5} />
          ) : isChecked ? (
            <Check className="h-[9px] w-[9px] text-text-strong" strokeWidth={2.5} />
          ) : null}
        </span>
        {label !== undefined && label !== null ? (
          <span className="min-w-0 truncate">{label}</span>
        ) : null}
      </label>
    );
  },
);
Checkbox.displayName = "Checkbox";
