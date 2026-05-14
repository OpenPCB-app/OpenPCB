import { useCallback, useMemo, type ReactElement } from "react";
import { Network, Trash2 } from "lucide-react";
import type {
  DesignerSchematicProjection,
  DesignerWire,
} from "../../../../../sdks";
import { Units } from "../../../../../shared/frontend/canvas/coords";
import type { DesignerWorkspaceActions } from "../../hooks/useDesignerWorkspace";

interface WireInspectorPanelProps {
  wire: DesignerWire;
  projection: DesignerSchematicProjection;
  dispatchCommand: DesignerWorkspaceActions["dispatchCommand"];
  setError: DesignerWorkspaceActions["setError"];
}

export function WireInspectorPanel({
  wire,
  projection,
  dispatchCommand,
  setError,
}: WireInspectorPanelProps): ReactElement {
  const memberNet = useMemo(
    () => projection.nets.find((net) => net.wireIds.includes(wire.id)) ?? null,
    [projection.nets, wire.id],
  );

  const lengthMm = useMemo(() => {
    let total = 0;
    for (let i = 1; i < wire.pointsNm.length; i += 1) {
      const a = wire.pointsNm[i - 1];
      const b = wire.pointsNm[i];
      if (!a || !b) continue;
      total += Math.hypot(b.x - a.x, b.y - a.y);
    }
    return Units.nmToMm(total);
  }, [wire.pointsNm]);

  const deleteWire = useCallback(async () => {
    try {
      await dispatchCommand({
        type: "delete_entity",
        entityId: wire.id,
        entityKind: "wire",
      });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to delete wire",
      );
    }
  }, [dispatchCommand, wire.id, setError]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-900">
        <Network className="h-4 w-4 text-violet-500 dark:text-violet-300" />
        <div className="flex min-w-0 flex-col">
          <span className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Net
          </span>
          <span
            className="truncate text-xs font-medium text-slate-800 dark:text-slate-100"
            title={memberNet?.name ?? "Unassigned"}
          >
            {memberNet?.name ?? "Unassigned"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-slate-500 dark:text-slate-500">
            Length
          </span>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs tabular-nums text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            {lengthMm.toFixed(2)} mm
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-slate-500 dark:text-slate-500">
            Segments
          </span>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs tabular-nums text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            {Math.max(wire.pointsNm.length - 1, 0)}
          </div>
        </div>
        {memberNet && (
          <>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-500 dark:text-slate-500">
                Pins
              </span>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs tabular-nums text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                {memberNet.pinIds.length}
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-500 dark:text-slate-500">
                Wires
              </span>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs tabular-nums text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                {memberNet.wireIds.length}
              </div>
            </div>
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => void deleteWire()}
        className="flex items-center justify-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-400 dark:hover:bg-rose-950/60"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete wire
      </button>
    </div>
  );
}
