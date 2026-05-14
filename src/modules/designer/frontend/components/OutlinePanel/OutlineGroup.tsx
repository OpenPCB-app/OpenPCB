import { useState, type ReactElement, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface OutlineGroupProps {
  label: string;
  count: number;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function OutlineGroup({
  label,
  count,
  defaultOpen = true,
  children,
}: OutlineGroupProps): ReactElement {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-1.5 px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-900"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <span>{label}</span>
        <span className="ml-1 rounded bg-slate-200 px-1 text-[10px] font-medium tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-400">
          {count}
        </span>
      </button>
      {open && count > 0 && <div className="flex flex-col">{children}</div>}
      {open && count === 0 && (
        <div className="px-3 pb-2 pt-0.5 text-[10px] italic text-slate-400 dark:text-slate-600">
          none
        </div>
      )}
    </div>
  );
}
