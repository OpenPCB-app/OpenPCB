import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { CircuitBoard, File as FileIcon, Network, Tag } from "lucide-react";
import type {
  DesignerLabel,
  DesignerPlacedPart,
  DesignerSchematicProjection,
  DesignerWire,
  LibraryComponent,
  LibraryComponentFootprintVariant,
} from "../../../../../sdks";
import type { DesignerWorkspaceActions } from "../../hooks/useDesignerWorkspace";
import { inferComponentClass } from "../../lib/outline-format";
import { ComponentClassIcon } from "../ComponentClassIcon";
import { PartInspectorPanel } from "./PartInspectorPanel";
import { MultiPartInspectorPanel } from "./MultiPartInspectorPanel";
import { LabelInspectorPanel } from "./LabelInspectorPanel";
import { WireInspectorPanel } from "./WireInspectorPanel";
import { PanelSectionHeader } from "@shared/frontend/ui/panel-section-header";
import { PropertyGrid, PropertyRow } from "@shared/frontend/ui/property-grid";

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
  /** Library record behind a selected part (Fields fallback); null while loading. */
  component?: LibraryComponent | null;
  dispatchCommand: DesignerWorkspaceActions["dispatchCommand"];
  setError: DesignerWorkspaceActions["setError"];
  /** Clears the 5 selection slots (rendered as the panel's "Deselect"). */
  onClose(): void;
  onOpenInLibrary?(componentId: string): void;
  /** Cross-probe the selected part to the PCB editor. */
  onCrossProbePcb?(part: DesignerPlacedPart): void;
  /** Open the change-footprint flow for a part's component. */
  onChangeFootprint?(part: DesignerPlacedPart): void;
}

const PANEL_CLASS =
  "flex h-full min-h-0 w-full flex-col overflow-hidden bg-surface-panel text-xs text-text";
const HEADER_CLASS =
  "flex h-[28px] shrink-0 items-center gap-1.5 border-b border-border px-2";
const HEADER_ICON_CLASS = "h-[13px] w-[13px] shrink-0 text-text-tertiary";

/**
 * Idle state of the Properties tab: a read-only summary of the sheet (design
 * D2 §7, "nothing selected"). ERC and net-class rows are omitted — no data.
 */
function SheetSummary({
  projection,
}: {
  projection: DesignerSchematicProjection;
}): ReactElement {
  // Same derivation the outline uses: a net counts once the user expressed
  // intent (a wire, a label or a power/portal primitive), never the auto
  // 1-pin nets the projection emits for unconnected pins.
  const netCount = useMemo(
    () =>
      projection.nets.filter(
        (net) =>
          net.wireIds.length > 0 ||
          net.labelIds.length > 0 ||
          net.primitiveIds.length > 0,
      ).length,
    [projection.nets],
  );

  return (
    <div className={PANEL_CLASS} data-testid="selection-inspector">
      <div className={HEADER_CLASS}>
        <FileIcon aria-hidden="true" className={HEADER_ICON_CLASS} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-strong">
          Sheet
        </span>
        <span className="shrink-0 text-xs text-text-tertiary">
          Nothing selected
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <PanelSectionHeader variant="uppercase" title="Summary" />
        <PropertyGrid>
          <PropertyRow label="Symbols" mono>
            {projection.parts.length}
          </PropertyRow>
          <PropertyRow label="Nets" mono>
            {netCount}
          </PropertyRow>
          <PropertyRow label="Labels" mono>
            {projection.labels.length}
          </PropertyRow>
        </PropertyGrid>
      </div>
    </div>
  );
}

export function SelectionInspector({
  selection,
  projection,
  variants,
  component = null,
  dispatchCommand,
  setError,
  onClose,
  onOpenInLibrary,
  onCrossProbePcb,
  onChangeFootprint,
}: SelectionInspectorProps): ReactElement {
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

  if (!selection) return <SheetSummary projection={projection} />;

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
          className={HEADER_ICON_CLASS}
        />
      );
      headerPrimary = selection.part.reference || selection.part.id.slice(0, 6);
      headerSecondary = inferComponentClass(selection.part);
      body = (
        <PartInspectorPanel
          part={selection.part}
          projection={projection}
          variants={variants}
          component={component}
          dispatchCommand={dispatchCommand}
          setError={setError}
          onOpenInLibrary={onOpenInLibrary}
          onCrossProbePcb={
            onCrossProbePcb ? () => onCrossProbePcb(selection.part) : undefined
          }
          onChangeFootprint={
            onChangeFootprint
              ? () => onChangeFootprint(selection.part)
              : undefined
          }
        />
      );
      break;
    }
    case "multi": {
      headerIcon = (
        <CircuitBoard aria-hidden="true" className={HEADER_ICON_CLASS} />
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
      headerIcon = <Tag aria-hidden="true" className={HEADER_ICON_CLASS} />;
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
      headerIcon = <Network aria-hidden="true" className={HEADER_ICON_CLASS} />;
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
    <div className={PANEL_CLASS} data-testid="selection-inspector">
      <div className={HEADER_CLASS}>
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
            className="h-[22px] min-w-0 flex-1 rounded-control border border-border-control bg-surface-input px-1.5 font-mono text-sm font-medium text-text-strong outline-none focus:border-selection"
          />
        ) : (
          <button
            type="button"
            onClick={() => allowReferenceEdit && setReferenceEditing(true)}
            disabled={!allowReferenceEdit}
            title={allowReferenceEdit ? "Click to rename" : undefined}
            className="min-w-0 flex-1 truncate text-left font-mono text-sm font-medium text-text-strong disabled:cursor-default"
          >
            {headerPrimary}
          </button>
        )}
        <span className="shrink-0 truncate text-xs text-text-tertiary">
          {headerSecondary}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
      <div className="flex h-[26px] shrink-0 items-center justify-end border-t border-border px-2">
        <button
          type="button"
          onClick={onClose}
          className="text-2xs text-text-tertiary transition-colors hover:text-text-strong"
        >
          Deselect
        </button>
      </div>
    </div>
  );
}
