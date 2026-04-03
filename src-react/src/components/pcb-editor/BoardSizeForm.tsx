import { usePcbStore } from "@/stores/pcb-store";

function parsePositiveNumber(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

export function BoardSizeForm() {
  const document = usePcbStore((state) => state.document);
  const setBoardSize = usePcbStore((state) => state.setBoardSize);

  if (!document) {
    return null;
  }

  const { width, height } = document.boardOutline;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-text-secondary">
          Board Size
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-[11px] text-text-muted">Width (mm)</span>
          <input
            type="number"
            min="1"
            step="0.1"
            value={width}
            className="h-8 w-full rounded-md border border-border-default bg-bg-input px-2 text-xs text-text-primary outline-none"
            onChange={(event) => {
              const nextWidth = parsePositiveNumber(event.target.value);
              if (nextWidth === null) {
                return;
              }
              setBoardSize(nextWidth, height);
            }}
          />
        </label>

        <label className="space-y-1">
          <span className="text-[11px] text-text-muted">Height (mm)</span>
          <input
            type="number"
            min="1"
            step="0.1"
            value={height}
            className="h-8 w-full rounded-md border border-border-default bg-bg-input px-2 text-xs text-text-primary outline-none"
            onChange={(event) => {
              const nextHeight = parsePositiveNumber(event.target.value);
              if (nextHeight === null) {
                return;
              }
              setBoardSize(width, nextHeight);
            }}
          />
        </label>
      </div>
    </div>
  );
}
