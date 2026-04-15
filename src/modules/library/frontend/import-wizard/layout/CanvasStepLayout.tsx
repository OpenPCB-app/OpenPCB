import {
  useCallback,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";

interface CanvasStepLayoutProps {
  topContent?: ReactNode;
  leftSidebar: ReactNode;
  center: ReactNode;
  rightSidebar: ReactNode;
  defaultLeftWidth?: number;
  defaultRightWidth?: number;
  minSidebarWidth?: number;
  maxSidebarWidth?: number;
}

type ResizeSide = "left" | "right";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function ResizeHandle({
  onPointerDown,
}: {
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}): ReactElement {
  return (
    <div
      className="group relative w-1 shrink-0 cursor-col-resize bg-slate-200 transition-colors hover:bg-violet-300 dark:bg-slate-800 dark:hover:bg-violet-700"
      onPointerDown={onPointerDown}
    >
      <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-slate-300 group-hover:bg-violet-400 dark:bg-slate-700 dark:group-hover:bg-violet-600" />
    </div>
  );
}

export function CanvasStepLayout({
  topContent,
  leftSidebar,
  center,
  rightSidebar,
  defaultLeftWidth = 280,
  defaultRightWidth = 320,
  minSidebarWidth = 220,
  maxSidebarWidth = 520,
}: CanvasStepLayoutProps): ReactElement {
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const [rightWidth, setRightWidth] = useState(defaultRightWidth);

  const startDrag = useCallback(
    (side: ResizeSide, event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = side === "left" ? leftWidth : rightWidth;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaX = moveEvent.clientX - startX;
        if (side === "left") {
          setLeftWidth(clamp(startWidth + deltaX, minSidebarWidth, maxSidebarWidth));
          return;
        }
        setRightWidth(clamp(startWidth - deltaX, minSidebarWidth, maxSidebarWidth));
      };

      const stopDrag = () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopDrag);
        window.removeEventListener("pointercancel", stopDrag);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopDrag);
      window.addEventListener("pointercancel", stopDrag);
    },
    [leftWidth, maxSidebarWidth, minSidebarWidth, rightWidth],
  );

  return (
    <div className="flex h-full min-h-0 w-full bg-white dark:bg-slate-900">
      <aside
        className="h-full shrink-0 overflow-x-hidden overflow-y-auto border-r border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900"
        style={{ width: leftWidth }}
      >
        {leftSidebar}
      </aside>

      <ResizeHandle onPointerDown={(event) => startDrag("left", event)} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-slate-900">
        <section className="relative min-h-0 min-w-0 flex-1 bg-white dark:bg-slate-900">
          {center}

          {topContent ? (
            <div className="pointer-events-none absolute left-1/2 top-3 z-20 w-full max-w-[520px] -translate-x-1/2 px-3">
              <div className="pointer-events-auto">{topContent}</div>
            </div>
          ) : null}
        </section>
      </div>

      <ResizeHandle onPointerDown={(event) => startDrag("right", event)} />

      <aside
        className="h-full shrink-0 overflow-x-hidden overflow-y-auto border-l border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900"
        style={{ width: rightWidth }}
      >
        {rightSidebar}
      </aside>
    </div>
  );
}
