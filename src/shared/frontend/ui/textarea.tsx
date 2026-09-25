import * as React from "react";
import { cn } from "@/lib/utils";
import { FIELD_BASE, FIELD_FOCUS, FIELD_INVALID } from "./focus";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Danger border + `aria-invalid`. */
  invalid?: boolean;
}

/** Themed multiline input. Shared by the comment composer + reply box. */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid = false, ...props }, ref) => (
    <textarea
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        "w-full resize-none px-2 py-1.5",
        FIELD_BASE,
        FIELD_FOCUS,
        invalid && FIELD_INVALID,
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
