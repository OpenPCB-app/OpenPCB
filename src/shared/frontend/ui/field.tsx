import * as React from "react";
import { cn } from "@/lib/utils";

export interface FieldProps {
  label: React.ReactNode;
  /** Id of the control; links the label and (via ids) hint/error text. */
  htmlFor?: string;
  hint?: React.ReactNode;
  /** Validation message; also sets `aria-invalid` on the child control. */
  error?: React.ReactNode;
  required?: boolean;
  /** Label left (96px column, like PropertyGrid), control right. */
  inline?: boolean;
  className?: string;
  children: React.ReactNode;
}

/** Hint/error element ids for a control id (for manual wiring). */
export function fieldMessageIds(htmlFor: string) {
  return { hintId: `${htmlFor}-hint`, errorId: `${htmlFor}-error` };
}

/**
 * Label + control + hint/error. When `htmlFor` is set and the child is a
 * single element, `aria-describedby` / `aria-invalid` are added to it.
 */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  required = false,
  inline = false,
  className,
  children,
}: FieldProps) {
  const ids = htmlFor ? fieldMessageIds(htmlFor) : null;
  const hasError = error !== undefined && error !== null && error !== false;
  const hasHint = hint !== undefined && hint !== null && hint !== false;
  const describedBy =
    [hasHint && !hasError ? ids?.hintId : undefined, hasError ? ids?.errorId : undefined]
      .filter(Boolean)
      .join(" ") || undefined;

  let control = children;
  if (ids && React.isValidElement<Record<string, unknown>>(children)) {
    const own = children.props["aria-describedby"];
    control = React.cloneElement(children, {
      "aria-describedby":
        [own, describedBy].filter((v) => typeof v === "string" && v).join(" ") ||
        undefined,
      "aria-invalid": hasError ? true : children.props["aria-invalid"],
    });
  }

  return (
    <div
      className={cn(
        inline ? "grid grid-cols-[96px_1fr] items-center gap-x-2" : "flex flex-col gap-1",
        className,
      )}
    >
      <label htmlFor={htmlFor} className="min-w-0 truncate text-xs text-text-secondary">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-status-danger">
            *
          </span>
        ) : null}
      </label>
      <div className="flex min-w-0 flex-col gap-1">
        {control}
        {hasHint && !hasError ? (
          <p id={ids?.hintId} className="text-2xs text-text-tertiary">
            {hint}
          </p>
        ) : null}
        {hasError ? (
          <p id={ids?.errorId} aria-live="polite" className="text-2xs text-status-danger">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
