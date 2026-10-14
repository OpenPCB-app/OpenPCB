import { X } from "lucide-react";
import { type ReactElement, type ReactNode } from "react";
import { useEscapeLayer } from "@shared/frontend/keyboard/use-escape-layer";

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
  useEscapeLayer(onClose);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col bg-surface-app/90 p-4 sm:p-8"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="mx-auto flex h-full w-full max-w-[1280px] flex-col overflow-hidden rounded-float border border-border bg-surface-panel shadow-lg"
      >
        <header className="flex h-[34px] items-center justify-between border-b border-border px-3">
          <span className="font-mono text-2xs uppercase tracking-[.04em] text-text-secondary">
            {title}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close preview"
            className="inline-flex h-[22px] w-[22px] cursor-pointer items-center justify-center rounded-control border border-border-control text-text-secondary outline-none transition-colors hover:bg-surface-hover hover:text-text-strong"
          >
            <X className="h-3 w-3" />
          </button>
        </header>
        <div className="min-h-0 flex-1 bg-surface-canvas-well">{children}</div>
      </div>
    </div>
  );
}
