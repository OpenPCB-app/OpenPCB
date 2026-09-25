import * as React from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGlobalShortcut } from "../keyboard/use-global-shortcut";
import { FIELD_BASE, FIELD_FOCUS_WITHIN } from "./focus";
import { Kbd } from "./kbd";

export interface SearchFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "type"> {
  /**
   * Accessible name. Always pass one; when omitted the placeholder is used as
   * a fallback so the field is never unnamed.
   */
  "aria-label"?: string;
  /**
   * Shortcut spec (see `formatShortcut`, e.g. `"/"`, `"Mod+K"`). The field
   * WIRES it — pressing it focuses + selects the input — and shows the hint.
   */
  shortcut?: string;
  /**
   * @deprecated Display-only hint; the caller must wire the key itself.
   * Prefer `shortcut`, which wires the key and renders the hint.
   */
  shortcutHint?: React.ReactNode;
  /** Class applied to the field wrapper (the visible box). */
  containerClassName?: string;
}

function isRendered(element: HTMLElement): boolean {
  return element.getClientRects().length > 0;
}

/** 22px search input with leading glyph (design D3 §5). */
export const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(
  (
    {
      shortcut,
      shortcutHint,
      containerClassName,
      className,
      autoComplete = "off",
      "aria-label": ariaLabel,
      placeholder,
      ...props
    },
    ref,
  ) => {
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    const setRefs = React.useCallback(
      (node: HTMLInputElement | null) => {
        innerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) ref.current = node;
      },
      [ref],
    );
    useGlobalShortcut(
      shortcut ?? "",
      () => {
        const input = innerRef.current;
        // Hidden (kept-mounted) spaces must not steal the key.
        if (!input || !isRendered(input)) return false;
        input.focus();
        input.select();
        return true;
      },
      { enabled: Boolean(shortcut) },
    );
    const hint = shortcut ? (
      <Kbd keys={shortcut} aria-hidden="true" className="ml-auto" />
    ) : shortcutHint !== undefined && shortcutHint !== null ? (
      <span
        aria-hidden="true"
        className="ml-auto shrink-0 font-mono text-2xs text-text-disabled"
      >
        {shortcutHint}
      </span>
    ) : null;
    return (
      <label
        className={cn(
          "flex h-[22px] min-w-0 items-center gap-1.5 px-1.5",
          FIELD_BASE,
          FIELD_FOCUS_WITHIN,
          containerClassName,
        )}
      >
        <Search aria-hidden="true" className="h-3 w-3 shrink-0 text-text-tertiary" />
        <input
          ref={setRefs}
          type="search"
          autoComplete={autoComplete}
          aria-label={ariaLabel ?? placeholder}
          placeholder={placeholder}
          className={cn(
            "min-w-0 flex-1 bg-transparent text-xs text-text-strong outline-none",
            "placeholder:text-text-disabled",
            "[&::-webkit-search-cancel-button]:appearance-none",
            className,
          )}
          {...props}
        />
        {hint}
      </label>
    );
  },
);
SearchField.displayName = "SearchField";
