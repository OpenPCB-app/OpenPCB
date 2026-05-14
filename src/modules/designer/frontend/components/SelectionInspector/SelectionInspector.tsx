import { useEffect, useRef, useState, type ReactElement } from "react";
import { CircuitBoard, Layers, Network, Tag, X } from "lucide-react";
import type {
  DesignerLabel,
  DesignerPlacedPart,
  DesignerSchematicProjection,
  DesignerWire,
  LibraryComponentFootprintVariant,
} from "../../../../../sdks";
import type { DesignerWorkspaceActions } from "../../hooks/useDesignerWorkspace";
import { PartInspectorPanel } from "./PartInspectorPanel";
import { MultiPartInspectorPanel } from "./MultiPartInspectorPanel";
import { LabelInspectorPanel } from "./LabelInspectorPanel";
import { WireInspectorPanel } from "./WireInspectorPanel";

export type InspectorSelection =
  | { kind: "part"; part: DesignerPlacedPart }
  | { kind: "multi"; parts: DesignerPlacedPart[] }
  | { kind: "label"; label: DesignerLabel }
  | { kind: "wire"; wire: DesignerWire }
  | null;

interface SelectionInspectorProps {
  selection: InspectorSelection;
  projection: DesignerSchematicProjection;
  variants: readonly LibraryComponentFootprintVariant[];
  dispatchCommand: DesignerWorkspaceActions["dispatchCommand"];
  setError: DesignerWorkspaceActions["setError"];
  onClose(): void;
  onOpenInLibrary?(componentId: string): void;
}

function inferComponentClass(part: DesignerPlacedPart): string {
  const name = part.symbol.name?.trim();
  if (name) return name;
  const ref = part.reference.toUpperCase();
  if (ref.startsWith("C")) return "Capacitor";
  if (ref.startsWith("R")) return "Resistor";
  if (ref.startsWith("L")) return "Inductor";
  if (ref.startsWith("D")) return "Diode";
  if (ref.startsWith("U")) return "IC";
  return "Component";
}

export function SelectionInspector({
  selection,
  projection,
  variants,
  dispatchCommand,
  setError,
  onClose,
  onOpenInLibrary,
}: SelectionInspectorProps): ReactElement | null {
  const [referenceDraft, setReferenceDraft] = useState("");
  const [referenceEditing, setReferenceEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const part = selection?.kind === "part" ? selection.part : null;

  useEffect(() => {
    if (part) {
      setReferenceDraft(part.reference);
      setReferenceEditing(false);
    }
  }, [part?.id, part?.reference]);

  useEffect(() => {
    if (referenceEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [referenceEditing]);

  if (!selection) return null;

  const commitReference = async () => {
    if (!part) {
      setReferenceEditing(false);
      return;
    }
    const trimmed = referenceDraft.trim();
    setReferenceEditing(false);
    if (trimmed.length === 0 || trimmed === part.reference) {
      setReferenceDraft(part.reference);
      return;
    }
    try {
      await dispatchCommand({
        type: "update_part_properties",
        partId: part.id,
        reference: trimmed,
      });
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to update reference",
      );
      setReferenceDraft(part.reference);
    }
  };

  let headerIcon: ReactElement;
  let headerPrimary: string;
  let headerSecondary: string;
  let body: ReactElement;

  switch (selection.kind) {
    case "part": {
      headerIcon = (
        <Layers className="h-3.5 w-3.5 text-violet-500 dark:text-violet-300" />
      );
      headerPrimary = selection.part.reference || selection.part.id.slice(0, 6);
      headerSecondary = inferComponentClass(selection.part);
      body = (
        <PartInspectorPanel
          part={selection.part}
          variants={variants}
          dispatchCommand={dispatchCommand}
          setError={setError}
          onOpenInLibrary={onOpenInLibrary}
          onReplaceComponentDisabledMessage="Per-instance override coming soon"
        />
      );
      break;
    }
    case "multi": {
      headerIcon = (
        <CircuitBoard className="h-3.5 w-3.5 text-violet-500 dark:text-violet-300" />
      );
      headerPrimary = `${selection.parts.length} parts`;
      headerSecondary = "Multi-selection";
      body = (
        <MultiPartInspectorPanel
          parts={selection.parts}
          dispatchCommand={dispatchCommand}
          setError={setError}
        />
      );
      break;
    }
    case "label": {
      headerIcon = (
        <Tag className="h-3.5 w-3.5 text-violet-500 dark:text-violet-300" />
      );
      headerPrimary = selection.label.text;
      headerSecondary = "Net label";
      body = (
        <LabelInspectorPanel
          label={selection.label}
          projection={projection}
          dispatchCommand={dispatchCommand}
          setError={setError}
        />
      );
      break;
    }
    case "wire": {
      const memberNet = projection.nets.find((net) =>
        net.wireIds.includes(selection.wire.id),
      );
      headerIcon = (
        <Network className="h-3.5 w-3.5 text-violet-500 dark:text-violet-300" />
      );
      headerPrimary = memberNet?.name ?? "Wire";
      headerSecondary = "Connection";
      body = (
        <WireInspectorPanel
          wire={selection.wire}
          projection={projection}
          dispatchCommand={dispatchCommand}
          setError={setError}
        />
      );
      break;
    }
  }

  const allowReferenceEdit = selection.kind === "part";

  return (
    <div
      className="pointer-events-auto absolute right-4 top-4 z-40 flex w-80 max-h-[70vh] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white/95 text-xs text-slate-800 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100"
      data-testid="selection-inspector"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
        {headerIcon}
        {allowReferenceEdit && referenceEditing ? (
          <input
            ref={inputRef}
            value={referenceDraft}
            onChange={(event) => setReferenceDraft(event.target.value)}
            onBlur={() => void commitReference()}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void commitReference();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setReferenceDraft(part?.reference ?? "");
                setReferenceEditing(false);
              }
            }}
            className="min-w-0 flex-1 rounded border border-violet-400 bg-white px-1 py-0 text-xs font-semibold text-slate-800 outline-none dark:border-violet-600 dark:bg-slate-800 dark:text-slate-100"
          />
        ) : (
          <button
            type="button"
            onClick={() => allowReferenceEdit && setReferenceEditing(true)}
            disabled={!allowReferenceEdit}
            title={allowReferenceEdit ? "Click to rename" : undefined}
            className="min-w-0 flex-1 truncate text-left text-xs font-semibold tracking-tight text-slate-800 disabled:cursor-default dark:text-slate-100"
          >
            {headerPrimary}
          </button>
        )}
        <span className="shrink-0 truncate text-[11px] text-slate-500 dark:text-slate-400">
          {headerSecondary}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspector"
          className="ml-1 shrink-0 rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{body}</div>
    </div>
  );
}
