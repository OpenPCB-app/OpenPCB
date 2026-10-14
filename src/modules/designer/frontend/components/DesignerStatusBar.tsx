import type { ReactElement } from "react";
import { GridControls } from "./GridControls";
import type { GridEditor } from "../stores/grid-prefs";
import { StatusBar, StatusSegment } from "@shared/frontend/ui/status-bar";
import { SeverityDiamond } from "@shared/frontend/ui/severity-diamond";
import {
  PCB_LAYER_COLORS,
  PCB_LAYER_LABELS,
} from "../../../../shared/frontend/canvas/layers";
import type { PcbLayerId } from "../../../../sdks";
import { usePcbCursorStore } from "../pcb/pcb-cursor-store";
import { useSchematicCursorStore } from "../stores/schematic-cursor-store";

const LAYER_COLORS = PCB_LAYER_COLORS as Record<string, string | undefined>;
const LAYER_LABELS = PCB_LAYER_LABELS as Record<string, string | undefined>;

interface DesignerStatusBarProps {
  /** Snap/grid pitch; omit when the editor has no grid snapping in effect. */
  gridMm?: number;
  gridEditor?: GridEditor;
  /** Zoom, in percent. */
  zoom: number;
  selection: string;
  drcCount?: number;
  /** When provided, the DRC segment becomes a button that opens the DRC tab. */
  onDrcClick?: () => void;
  /** Parts with no usable footprint (PCB only); chip hidden when 0/absent. */
  unresolvedFootprintCount?: number;
  /** Click handler for the unresolved-footprint chip (select + frame). */
  onUnresolvedFootprintsClick?: () => void;
  /** Label for the violation-count segment — "ERC" on the schematic. */
  drcLabel?: string;
  /** Native tooltip for the violation-count segment. */
  drcTitle?: string;
  /** Render the X / Y cursor segments. */
  showCursor?: boolean;
  /** Which editor's cursor store the X / Y readout subscribes to. */
  cursorSource?: "pcb" | "schematic";
  /** Active copper layer chip (PCB only). */
  activeLayer?: PcbLayerId | null;
  /** Contextual tool hint; fills the remaining width. */
  hint?: string;
  /** Board view side chip; omitted when unknown. */
  viewSide?: "top" | "bottom" | null;
  /** Trailing unit segment. */
  unit?: string;
}

function formatMm(value: number): string {
  return value.toFixed(3);
}

function CursorSegment({
  point,
}: {
  point: { xMm: number; yMm: number } | null;
}): ReactElement {
  return (
    <StatusSegment className="shrink-0">
      <span className="text-text-caps">X</span>
      <span
        className="w-[9ch] shrink-0 truncate text-right tabular-nums text-text-strong"
        title={point ? formatMm(point.xMm) : undefined}
      >
        {point ? formatMm(point.xMm) : "—"}
      </span>
      <span className="text-text-caps">Y</span>
      <span
        className="w-[9ch] shrink-0 truncate text-right tabular-nums text-text-strong"
        title={point ? formatMm(point.yMm) : undefined}
      >
        {point ? formatMm(point.yMm) : "—"}
      </span>
    </StatusSegment>
  );
}

/**
 * X / Y cursor segments. Each variant subscribes to its editor's cursor store
 * itself so pointer moves re-render only this segment, never the editor shell.
 * Two components rather than one with a conditional hook call.
 */
function PcbCursorReadout(): ReactElement {
  return <CursorSegment point={usePcbCursorStore((s) => s.point)} />;
}

function SchematicCursorReadout(): ReactElement {
  return <CursorSegment point={useSchematicCursorStore((s) => s.point)} />;
}

/** 22px editor status bar (design D2 §9). */
export function DesignerStatusBar({
  gridMm,
  gridEditor,
  zoom,
  selection,
  drcCount,
  onDrcClick,
  unresolvedFootprintCount,
  onUnresolvedFootprintsClick,
  drcLabel = "DRC",
  drcTitle = "Design rule violations",
  showCursor = false,
  cursorSource = "pcb",
  activeLayer,
  hint = "",
  viewSide,
  unit = "mm",
}: DesignerStatusBarProps): ReactElement {
  const layerColor = activeLayer ? LAYER_COLORS[activeLayer] : undefined;
  const layerLabel = activeLayer
    ? (LAYER_LABELS[activeLayer] ?? activeLayer)
    : null;

  return (
    <StatusBar>
      {showCursor ? (
        cursorSource === "schematic" ? (
          <SchematicCursorReadout />
        ) : (
          <PcbCursorReadout />
        )
      ) : null}
      {gridEditor && <GridControls editor={gridEditor} />}
      {gridMm !== undefined && (
        <StatusSegment>
          <span className="text-text-caps">grid</span>
          <span className="text-text-strong">{gridMm.toFixed(2)} mm</span>
        </StatusSegment>
      )}
      <StatusSegment>
        <span className="text-text-caps">zoom</span>
        <span className="text-text-strong">{zoom.toFixed(0)}%</span>
      </StatusSegment>
      {activeLayer ? (
        <StatusSegment>
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 shrink-0 ring-1 ring-black/40"
            style={{ backgroundColor: layerColor }}
          />
          <span className="font-sans text-text-strong">{layerLabel}</span>
          <span className="text-text-disabled">{activeLayer}</span>
        </StatusSegment>
      ) : null}
      <StatusSegment flex sans className="text-text-tertiary">
        {hint}
      </StatusSegment>
      {unresolvedFootprintCount !== undefined && unresolvedFootprintCount > 0 ? (
        <StatusSegment
          title="Parts with no usable footprint — nets on them cannot be routed"
          {...(onUnresolvedFootprintsClick
            ? {
                onClick: onUnresolvedFootprintsClick,
                "aria-label": `${unresolvedFootprintCount} unresolved footprints`,
              }
            : {})}
        >
          <SeverityDiamond severity="warning" />
          <span className="font-medium text-status-warning">
            {unresolvedFootprintCount}
          </span>
          <span className="text-text-caps">
            unresolved {unresolvedFootprintCount === 1 ? "footprint" : "footprints"}
          </span>
        </StatusSegment>
      ) : null}
      {drcCount !== undefined ? (
        <StatusSegment
          title={drcTitle}
          {...(onDrcClick
            ? { onClick: onDrcClick, "aria-label": `${drcCount} ${drcLabel}` }
            : {})}
        >
          <SeverityDiamond severity={drcCount > 0 ? "error" : "info"} />
          <span
            className={
              drcCount > 0 ? "font-medium text-status-danger" : undefined
            }
          >
            {drcCount}
          </span>
          <span className="text-text-caps">{drcLabel}</span>
        </StatusSegment>
      ) : null}
      <StatusSegment sans className="max-w-[240px] truncate">
        {selection}
      </StatusSegment>
      {viewSide ? (
        <StatusSegment>
          <span className="text-text-caps">view</span>
          <span className="text-text-strong">{viewSide}</span>
        </StatusSegment>
      ) : null}
      <StatusSegment>{unit}</StatusSegment>
    </StatusBar>
  );
}
