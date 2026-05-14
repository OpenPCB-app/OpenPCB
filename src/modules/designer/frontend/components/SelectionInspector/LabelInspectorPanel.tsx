import { useCallback, useEffect, useState, type ReactElement } from "react";
import { Trash2 } from "lucide-react";
import type {
  DesignerLabel,
  DesignerSchematicProjection,
} from "../../../../../sdks";
import type { DesignerWorkspaceActions } from "../../hooks/useDesignerWorkspace";

interface LabelInspectorPanelProps {
  label: DesignerLabel;
  projection: DesignerSchematicProjection;
  dispatchCommand: DesignerWorkspaceActions["dispatchCommand"];
  setError: DesignerWorkspaceActions["setError"];
}

export function LabelInspectorPanel({
  label,
  projection,
  dispatchCommand,
  setError,
}: LabelInspectorPanelProps): ReactElement {
  const [textDraft, setTextDraft] = useState(label.text);

  useEffect(() => {
    setTextDraft(label.text);
  }, [label.text]);

  const memberNet = projection.nets.find((net) =>
    net.labelIds.includes(label.id),
  );

  const commitText = useCallback(async () => {
    const trimmed = textDraft.trim();
    if (trimmed.length === 0 || trimmed === label.text) {
      setTextDraft(label.text);
      return;
    }
    try {
      await dispatchCommand({
        type: "upsert_label",
        labelId: label.id,
        text: trimmed,
        positionNm: label.positionNm,
      });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to update label",
      );
      setTextDraft(label.text);
    }
  }, [
    dispatchCommand,
    label.id,
    label.positionNm,
    label.text,
    setError,
    textDraft,
  ]);

  const deleteLabel = useCallback(async () => {
    try {
      await dispatchCommand({
        type: "delete_entity",
        entityId: label.id,
        entityKind: "label",
      });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to delete label",
      );
    }
  }, [dispatchCommand, label.id, setError]);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-0.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Text
        </span>
        <input
          value={textDraft}
          onChange={(event) => setTextDraft(event.target.value)}
          onBlur={() => void commitText()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 outline-none focus:border-violet-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        />
      </label>

      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Net
        </span>
        <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
          {memberNet ? memberNet.name : "Unconnected"}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-slate-500 dark:text-slate-500">
            X (mm)
          </span>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            {(label.positionNm.x / 1_000_000).toFixed(3)}
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] text-slate-500 dark:text-slate-500">
            Y (mm)
          </span>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            {(label.positionNm.y / 1_000_000).toFixed(3)}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void deleteLabel()}
        className="flex items-center justify-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-400 dark:hover:bg-rose-950/60"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete label
      </button>
    </div>
  );
}
