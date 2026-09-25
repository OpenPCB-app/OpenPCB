import * as React from "react";
import { cn } from "@/lib/utils";
import { formatShortcut } from "./shortcut";

export interface KbdProps extends React.HTMLAttributes<HTMLElement> {
  /**
   * A shortcut spec (`"Mod+K"` → ⌘K / Ctrl+K) or a sequence of them
   * (`["G", "G"]`), each rendered as its own key cap.
   */
  keys: string | readonly string[];
}

const CAP =
  "inline-flex h-4 min-w-4 items-center justify-center rounded-control border border-border-control bg-surface-raised px-1 font-mono text-2xs leading-none text-text-secondary";

/** Keyboard shortcut key cap(s), formatted for the current platform. */
export function Kbd({ keys, className, ...props }: KbdProps) {
  if (typeof keys === "string") {
    return (
      <kbd className={cn(CAP, className)} {...props}>
        {formatShortcut(keys)}
      </kbd>
    );
  }
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-0.5", className)} {...props}>
      {keys.map((key, index) => (
        <kbd key={`${key}-${index}`} className={CAP}>
          {formatShortcut(key)}
        </kbd>
      ))}
    </span>
  );
}
