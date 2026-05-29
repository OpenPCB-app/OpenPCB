import { X } from "lucide-react";
import { useEffect, type ReactElement, type ReactNode } from "react";

interface PreviewModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Full-screen overlay for inspecting a large symbol / footprint preview. */
export function PreviewModal({
  title,
  onClose,
  children,
}: PreviewModalProps): ReactElement {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col bg-slate-950/80 p-4 backdrop-blur-sm sm:p-8"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="mx-auto flex h-full w-full max-w-[1280px] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
          <span className="font-mono text-xs font-semibold uppercase tracking-wider text-slate-300">
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-600 text-slate-300 transition-colors hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 bg-slate-950">{children}</div>
      </div>
    </div>
  );
}
