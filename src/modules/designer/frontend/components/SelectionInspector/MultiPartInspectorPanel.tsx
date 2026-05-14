import { useCallback, useMemo, useState, type ReactElement } from "react";
import { Trash2 } from "lucide-react";
import type { DesignerPlacedPart } from "../../../../../sdks";
import type { DesignerWorkspaceActions } from "../../hooks/useDesignerWorkspace";

interface MultiPartInspectorPanelProps {
  parts: DesignerPlacedPart[];
  dispatchCommand: DesignerWorkspaceActions["dispatchCommand"];
  setError: DesignerWorkspaceActions["setError"];
}

export function MultiPartInspectorPanel({
  parts,
  dispatchCommand,
  setError,
}: MultiPartInspectorPanelProps): ReactElement {
  const [batchValue, setBatchValue] = useState("");

  const commonComponentId = useMemo(() => {
    const first = parts[0]?.componentId;
    if (!first) return null;
    return parts.every((part) => part.componentId === first) ? first : null;
  }, [parts]);

  const applyBatchValue = useCallback(async () => {
    if (!batchValue.trim()) return;
    try {
      await dispatchCommand({
        type: "update_parts_properties",
        partIds: parts.map((part) => part.id),
        value: batchValue.trim(),
      });
      setBatchValue("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Failed to batch edit");
    }
  }, [batchValue, parts, dispatchCommand, setError]);

  const deleteAll = useCallback(async () => {
    for (const part of parts) {
      try {
        await dispatchCommand({
          type: "delete_entity",
          entityId: part.id,
          entityKind: "part",
        });
      } catch (error) {
        setError(error instanceof Error ? error.message : "Failed to delete");
        return;
      }
    }
  }, [parts, dispatchCommand, setError]);

  return (
    <div className="flex flex-col gap-3">
      <section className="flex flex-col gap-1 rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-slate-900">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {parts.length} parts selected
        </p>
        {commonComponentId ? (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Same component type · batch edit available
          </p>
        ) : (
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Mixed component types
          </p>
        )}
      </section>

      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Set Value (batch)
        </span>
        <div className="flex gap-2">
          <input
            value={batchValue}
            onChange={(event) => setBatchValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void applyBatchValue();
            }}
            placeholder="e.g. 10nF"
            className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          />
          <button
            type="button"
            onClick={() => void applyBatchValue()}
            className="rounded-md bg-violet-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-violet-500"
          >
            Apply
          </button>
        </div>
      </label>

      <button
        type="button"
        onClick={() => void deleteAll()}
        className="flex items-center justify-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-400 dark:hover:bg-rose-950/60"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete all {parts.length}
      </button>
    </div>
  );
}
