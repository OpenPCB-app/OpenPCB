import { useEffect, useRef, useState, type ReactElement } from "react";
import { CircuitBoard, Network, PanelRightClose, Tag, X } from "lucide-react";
import type {
  DesignerLabel,
  DesignerPlacedPart,
  DesignerSchematicProjection,
  DesignerWire,
  LibraryComponentFootprintVariant,
} from "../../../../../sdks";
import type { DesignerWorkspaceActions } from "../../hooks/useDesignerWorkspace";
import { inferComponentClass } from "../../lib/outline-format";
import { ComponentClassIcon } from "../ComponentClassIcon";
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
  /** When true, render as a docked column (full height, no overlay chrome). */
  docked?: boolean;
  /** Collapse the docked column (docked mode only). */
  onCollapse?(): void;
  /** Cross-probe the selected part to the PCB editor. */
  onCrossProbePcb?(part: DesignerPlacedPart): void;
}

export function SelectionInspector({
  selection,
  projection,
  variants,
  dispatchCommand,
  setError,
  onClose,
  onOpenInLibrary,
  docked = false,
  onCollapse,
  onCrossProbePcb,
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

  const containerClass = docked
    ? "relative flex h-full w-full flex-col overflow-hidden border-l border-slate-200 bg-white text-xs text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
    : "pointer-events-auto absolute right-4 top-4 z-40 flex max-h-[70vh] w-80 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white/95 text-xs text-slate-800 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-100";

  const dismissButton =
    docked && onCollapse ? (
      <button
        type="button"
        onClick={onCollapse}
        aria-label="Collapse inspector"
        className="ml-1 shrink-0 cursor-pointer rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <PanelRightClose className="h-3.5 w-3.5" />
      </button>
    ) : (
      <button
        type="button"
        onClick={onClose}
        aria-label="Close inspector"
        className="ml-1 shrink-0 cursor-pointer rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    );

  // Docked mode keeps the column present with a placeholder so the layout is
  // stable; floating mode simply disappears when nothing is selected.
  if (!selection) {
    if (!docked) return null;
    return (
      <div className={containerClass} data-testid="selection-inspector">
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
          <span className="min-w-0 flex-1 truncate text-xs font-semibold tracking-tight text-slate-500 dark:text-slate-400">
            Inspector
          </span>
          {dismissButton}
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center px-4 py-6 text-center text-[11px] text-slate-400 dark:text-slate-500">
          Select a part to inspect its properties.
        </div>
      </div>
    );
  }

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
        <ComponentClassIcon
          part={selection.part}
          className="h-3.5 w-3.5 shrink-0 text-violet-500 dark:text-violet-300"
        />
      );
      headerPrimary = selection.part.reference || selection.part.id.slice(0, 6);
      headerSecondary = inferComponentClass(selection.part);
      body = (
        <PartInspectorPanel
          part={selection.part}
          projection={projection}
          variants={variants}
          dispatchCommand={dispatchCommand}
          setError={setError}
          onOpenInLibrary={onOpenInLibrary}
          onCrossProbePcb={
            onCrossProbePcb ? () => onCrossProbePcb(selection.part) : undefined
          }
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
    <div className={containerClass} data-testid="selection-inspector">
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
        {dismissButton}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{body}</div>
    </div>
  );
}
