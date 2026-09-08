import {
  Ban,
  CircuitBoard,
  Circle,
  LayoutGrid,
  Package,
  Square,
  Type,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import type { DesignerPcbProjection } from "../../../../sdks";
import { PanelSectionHeader } from "@shared/frontend/ui/panel-section-header";
import { PropertyGrid, PropertyRow } from "@shared/frontend/ui/property-grid";
import { TableHeaderRow, TableRow } from "@shared/frontend/ui/data-table";
import {
  PCB_LAYER_COLORS,
  PCB_LAYER_LABELS,
} from "../../../../shared/frontend/canvas/layers";
import {
  FreeHolePanel,
  FreePadPanel,
  KeepoutPanel,
  OverlayTextPanel,
  ZonePanel,
  type PcbInspectorSelection,
} from "./PcbSelectionInspector";
import type { PcbSelection } from "./pcb-selection";

const PAD_COLS = "32px 1fr 88px";

const LAYER_COLORS = PCB_LAYER_COLORS as Record<string, string | undefined>;
const LAYER_LABELS = PCB_LAYER_LABELS as Record<string, string | undefined>;

interface PcbPropertiesPanelProps {
  selection: PcbSelection;
  projection: DesignerPcbProjection;
  /** Idle state body — the board settings panel. */
  boardPanel: ReactNode;
  /** Single free hole / pad / overlay-text selection, when that's what's picked. */
  inspectorSelection: PcbInspectorSelection;
  /**
   * Schematic part id → value. The PCB projection carries no value field, so
   * the designer shell passes the schematic projection's map through.
   */
  partValues: ReadonlyMap<string, string>;
  onUpdateFreeHole(id: string, patch: { drillMm?: number }): Promise<void>;
  onDeleteFreeHole(id: string): Promise<void>;
  onUpdateFreePad(
    id: string,
    patch: Parameters<
      NonNullable<React.ComponentProps<typeof FreePadPanel>["onUpdate"]>
    >[0],
  ): Promise<void>;
  onDeleteFreePad(id: string): Promise<void>;
  onUpdateOverlayText(
    id: string,
    patch: Parameters<
      NonNullable<React.ComponentProps<typeof OverlayTextPanel>["onUpdate"]>
    >[0],
  ): Promise<void>;
  onDeleteOverlayText(id: string): Promise<void>;
  /** Nets available to a zone, in the same order the pour pickers use. */
  nets: ReadonlyArray<{ id: string; name: string }>;
  onUpdateZone(
    id: string,
    patch: Parameters<React.ComponentProps<typeof ZonePanel>["onUpdate"]>[0],
  ): Promise<void>;
  onDeleteZone(id: string): Promise<void>;
  onUpdateKeepout(
    id: string,
    patch: Parameters<React.ComponentProps<typeof KeepoutPanel>["onUpdate"]>[0],
  ): Promise<void>;
  onDeleteKeepout(id: string): Promise<void>;
}

function DockHeader({
  icon,
  title,
  kind,
  mono = false,
}: {
  icon: ReactNode;
  title: string;
  kind: string;
  mono?: boolean;
}): ReactElement {
  return (
    <div className="flex h-[28px] shrink-0 items-center gap-1.5 border-b border-border px-2">
      <span className="shrink-0 text-text-tertiary [&_svg]:h-[13px] [&_svg]:w-[13px]">
        {icon}
      </span>
      <span
        className={`min-w-0 truncate text-sm font-medium text-text-strong ${mono ? "font-mono" : ""}`}
        title={title}
      >
        {title}
      </span>
      <span className="shrink-0 text-xs text-text-tertiary">{kind}</span>
    </div>
  );
}

function LayerValue({ layer }: { layer: string }): ReactElement {
  const color = LAYER_COLORS[layer];
  const label = LAYER_LABELS[layer];
  return (
    <span className="flex items-center gap-1.5">
      <span
        aria-hidden
        className="inline-block h-2 w-2 shrink-0 ring-1 ring-black/40"
        style={{ backgroundColor: color }}
      />
      <span className="truncate font-sans">{label ?? layer}</span>
      <span className="shrink-0 font-mono text-text-disabled">{layer}</span>
    </span>
  );
}

/**
 * PCB Properties tab body (design D2 §7). Portalled by `PcbCanvas` into the
 * right dock; it renders the board settings when nothing is selected, the
 * footprint inspector for a single placement, the free-primitive panels for a
 * hole / pad / overlay text, and a count summary for multi-selections.
 */
export function PcbPropertiesPanel({
  selection,
  projection,
  boardPanel,
  inspectorSelection,
  partValues,
  onUpdateFreeHole,
  onDeleteFreeHole,
  onUpdateFreePad,
  onDeleteFreePad,
  onUpdateOverlayText,
  onDeleteOverlayText,
  nets,
  onUpdateZone,
  onDeleteZone,
  onUpdateKeepout,
  onDeleteKeepout,
}: PcbPropertiesPanelProps): ReactElement {
  const placementIds = [...selection.placementIds];
  const counts: Array<[string, number]> = [
    ["Footprints", selection.placementIds.size],
    ["Traces", selection.traceIds.size],
    ["Vias", selection.viaIds.size],
    ["Holes", selection.freeHoleIds?.size ?? 0],
    ["Pads", selection.freePadIds?.size ?? 0],
    ["Texts", selection.overlayTextIds?.size ?? 0],
    ["Zones", selection.zoneIds?.size ?? 0],
    ["Keepouts", selection.keepoutIds?.size ?? 0],
  ];
  const total = counts.reduce((sum, [, n]) => sum + n, 0);

  // 1. Single free primitive → the existing per-kind panels.
  if (total === 1 && inspectorSelection) {
    switch (inspectorSelection.kind) {
      case "freeHole":
        return (
          <div className="flex min-h-0 flex-col">
            <DockHeader
              icon={<Circle />}
              title="Hole"
              kind={`Ø ${inspectorSelection.hole.drillMm} mm`}
            />
            <FreeHolePanel
              hole={inspectorSelection.hole}
              onUpdate={(patch) =>
                onUpdateFreeHole(inspectorSelection.hole.id, patch)
              }
              onDelete={() => onDeleteFreeHole(inspectorSelection.hole.id)}
            />
          </div>
        );
      case "freePad":
        return (
          <div className="flex min-h-0 flex-col">
            <DockHeader
              icon={<Square />}
              title="Pad"
              kind={`${inspectorSelection.pad.widthMm}×${inspectorSelection.pad.heightMm} mm`}
            />
            <FreePadPanel
              pad={inspectorSelection.pad}
              onUpdate={(patch) =>
                onUpdateFreePad(inspectorSelection.pad.id, patch)
              }
              onDelete={() => onDeleteFreePad(inspectorSelection.pad.id)}
            />
          </div>
        );
      case "overlayText":
        return (
          <div className="flex min-h-0 flex-col">
            <DockHeader
              icon={<Type />}
              title={inspectorSelection.text.text}
              kind={
                inspectorSelection.text.layer === "F.SilkS"
                  ? "Top Overlay"
                  : inspectorSelection.text.layer === "B.SilkS"
                    ? "Bottom Overlay"
                    : inspectorSelection.text.layer
              }
            />
            <OverlayTextPanel
              text={inspectorSelection.text}
              onUpdate={(patch) =>
                onUpdateOverlayText(inspectorSelection.text.id, patch)
              }
              onDelete={() => onDeleteOverlayText(inspectorSelection.text.id)}
            />
          </div>
        );
      case "zone":
        return (
          <div className="flex min-h-0 flex-col">
            <DockHeader
              icon={<LayoutGrid />}
              title={
                inspectorSelection.zone.name ??
                (inspectorSelection.zone.region.kind === "board"
                  ? "Board zone"
                  : "Zone")
              }
              kind={inspectorSelection.zone.layer}
            />
            <ZonePanel
              zone={inspectorSelection.zone}
              nets={nets}
              layerCount={projection.board.layerCount}
              onUpdate={(patch) =>
                onUpdateZone(inspectorSelection.zone.id, patch)
              }
              onDelete={() => onDeleteZone(inspectorSelection.zone.id)}
            />
          </div>
        );
      case "keepout":
        return (
          <div className="flex min-h-0 flex-col">
            <DockHeader
              icon={<Ban />}
              title={inspectorSelection.keepout.name ?? "Keepout"}
              kind={inspectorSelection.keepout.layers.join(", ")}
            />
            <KeepoutPanel
              keepout={inspectorSelection.keepout}
              layerCount={projection.board.layerCount}
              onUpdate={(patch) =>
                onUpdateKeepout(inspectorSelection.keepout.id, patch)
              }
              onDelete={() => onDeleteKeepout(inspectorSelection.keepout.id)}
            />
          </div>
        );
    }
  }

  // 2. Exactly one placement → footprint properties.
  if (total === 1 && placementIds.length === 1) {
    const placement = projection.placements.find(
      (p) => p.id === placementIds[0],
    );
    if (placement) {
      const pads = placement.footprint.preview?.pads ?? [];
      const shownPads = pads.slice(0, 8);
      const netNameFor = (padNumber: string): string => {
        const netId = projection.padNets?.[`${placement.id}|${padNumber}`];
        if (!netId) return "—";
        return projection.netNames[netId] ?? netId;
      };
      return (
        <div className="flex min-h-0 flex-col">
          <DockHeader
            icon={<Package />}
            title={placement.reference}
            kind="Footprint"
            mono
          />
          <PanelSectionHeader variant="uppercase" title="General" />
          <PropertyGrid>
            <PropertyRow label="Reference" mono>
              {placement.reference}
            </PropertyRow>
            <PropertyRow label="Value" mono>
              {partValues.get(placement.partId) ?? "—"}
            </PropertyRow>
            <PropertyRow
              label="Footprint"
              mono
              title={placement.footprint.name}
            >
              {placement.footprint.name}
            </PropertyRow>
            <PropertyRow label="Layer">
              <LayerValue layer={placement.layer} />
            </PropertyRow>
            <PropertyRow label="Side">
              {placement.layer === "B.Cu" || placement.mirrored
                ? "Bottom"
                : "Top"}
            </PropertyRow>
          </PropertyGrid>
          <PanelSectionHeader variant="uppercase" title="Location" />
          <PropertyGrid>
            <PropertyRow label="X" mono hint="mm">
              {placement.positionMm.x.toFixed(3)}
            </PropertyRow>
            <PropertyRow label="Y" mono hint="mm">
              {placement.positionMm.y.toFixed(3)}
            </PropertyRow>
            <PropertyRow label="Rotation" mono hint="°">
              {placement.rotationDeg.toFixed(1)}
            </PropertyRow>
          </PropertyGrid>
          <PanelSectionHeader
            variant="uppercase"
            title="Pads"
            count={pads.length}
          />
          <div className="min-h-0">
            {pads.length === 0 ? (
              // Placements imported without a footprint preview snapshot have
              // no pad geometry to show — say so instead of an empty table.
              <div className="flex h-[22px] items-center px-[10px] text-2xs text-text-tertiary">
                Pad geometry unavailable for this footprint
              </div>
            ) : null}
            {pads.length > 0 ? (
              <TableHeaderRow cols={PAD_COLS}>
                <span>#</span>
                <span>Net</span>
                <span className="text-right">Size mm</span>
              </TableHeaderRow>
            ) : null}
            {shownPads.map((pad) => (
              <TableRow key={pad.id} cols={PAD_COLS} className="font-mono">
                <span className="truncate">{pad.number}</span>
                <span className="truncate">{netNameFor(pad.number)}</span>
                <span className="truncate text-right text-text-tertiary">
                  {pad.widthMm.toFixed(2)} × {pad.heightMm.toFixed(2)}
                </span>
              </TableRow>
            ))}
            {pads.length > shownPads.length ? (
              <div className="px-[10px] py-1 text-2xs text-text-disabled">
                +{pads.length - shownPads.length} more pads
              </div>
            ) : null}
          </div>
        </div>
      );
    }
  }

  // 3. Anything else that is selected (traces, vias, multi-selection) →
  //    counts by kind. `total >= 1` so a single trace/via never falls through
  //    to the board state while the status bar reports "1 selected".
  if (total >= 1) {
    return (
      <div className="flex min-h-0 flex-col">
        <DockHeader
          icon={<Package />}
          title={total === 1 ? "1 item selected" : `${total} items selected`}
          kind="Selection"
        />
        <PanelSectionHeader variant="uppercase" title="Contents" />
        <PropertyGrid>
          {counts
            .filter(([, n]) => n > 0)
            .map(([label, n]) => (
              <PropertyRow key={label} label={label} mono>
                {n}
              </PropertyRow>
            ))}
        </PropertyGrid>
      </div>
    );
  }

  // 4. Nothing selected → board settings.
  return (
    <div className="flex min-h-0 flex-col">
      <DockHeader
        icon={<CircuitBoard />}
        title="Board"
        kind="Nothing selected"
      />
      {boardPanel}
    </div>
  );
}
