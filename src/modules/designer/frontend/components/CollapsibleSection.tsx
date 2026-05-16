import { ChevronDown, ChevronRight } from "lucide-react";
import {
  useCallback,
  useEffect,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

interface CollapsibleSectionProps {
  /** Stable id used as the localStorage key (e.g. "pcb.sidebar.board"). */
  id: string;
  title: string;
  defaultOpen?: boolean;
  /** Optional element rendered on the right side of the header row. */
  trailing?: ReactNode;
  children: ReactNode;
  className?: string;
}

function readStored(id: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(id);
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch {
    // ignore
  }
  return fallback;
}

/**
 * Collapsible section with chevron + title. Content stays mounted while
 * collapsed (via `hidden`) so React portal targets remain valid.
 */
export function CollapsibleSection({
  id,
  title,
  defaultOpen = true,
  trailing,
  children,
  className,
}: CollapsibleSectionProps): ReactElement {
  const [open, setOpen] = useState<boolean>(() => readStored(id, defaultOpen));

  useEffect(() => {
    try {
      window.localStorage.setItem(id, open ? "1" : "0");
    } catch {
      // ignore quota / privacy errors
    }
  }, [id, open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <section
      className={`flex min-h-0 flex-col border-b border-slate-200 dark:border-slate-800 ${className ?? ""}`}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="inline-flex flex-1 items-center gap-1 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate">{title}</span>
        </button>
        {trailing}
      </div>
      <div hidden={!open} className="min-h-0 flex-1">
        {children}
      </div>
    </section>
  );
}
