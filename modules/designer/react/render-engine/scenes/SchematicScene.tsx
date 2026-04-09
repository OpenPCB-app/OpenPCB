/**
 * SchematicScene — Composes R3F primitives for schematic rendering.
 *
 * Used by: SchematicCanvas, SymbolEditorCanvas, SymbolPreview.
 * Config-driven: editable vs readOnly, visible layers, interaction.
 *
 * Renders: symbols (body + pins + labels), wires, net labels,
 * junction dots, selection overlay, placement/wire preview.
 */

import { useMemo } from "react";
import type {
  SchematicDocument,
  DerivedConnectivity,
  SymbolEntity,
  WireEntity,
  NetLabelEntity,
  InteractionSession,
  Bounds,
} from "@/components/pcb/types";
import type { CanvasColors } from "@/lib/canvas-theme";
import { SymbolBody } from "../primitives/SymbolBody";
import { WireLines } from "../primitives/WireLines";
import { PinDots } from "../primitives/PinDots";
import { JunctionDots } from "../primitives/JunctionDots";
import { EDAText } from "../primitives/EDAText";
import { SelectionOverlay } from "../primitives/SelectionOverlay";
import { degreesToRadians, Units, NM_TO_SCENE } from "../coords";
import { RENDER_ORDER } from "../layers";

/** Scale factor applied to root group: converts nm → mm for Three.js scene */
const S = 1 / NM_TO_SCENE;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface SchematicSceneConfig {
  /** Whether entities are interactive (false for previews) */
  editable?: boolean;
  /** Show grid (controlled externally by GridShader) */
  showGrid?: boolean;
  /** Grid size for snap reference */
  gridSize?: number;
  /** Set of selected entity IDs */
  selectedIds?: ReadonlySet<string>;
  /** Set of connected pin IDs (for pin dot coloring) */
  connectedPinIds?: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SchematicSceneProps {
  /** Schematic document data */
  document: SchematicDocument | null;
  /** Derived connectivity (junctions) */
  connectivity?: DerivedConnectivity | null;
  /** Session state (placement, wire, drag preview) */
  session?: InteractionSession;
  /** Scene configuration */
  config?: SchematicSceneConfig;
  /** Canvas theme colors */
  colors: CanvasColors;
  /** Hit test cache for selection bounds */
  symbolBounds?: Record<string, Bounds>;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SchematicScene({
  document: doc,
  connectivity,
  session,
  config = {},
  colors,
  symbolBounds = {},
}: SchematicSceneProps) {
  const {
    selectedIds = new Set<string>(),
    connectedPinIds = new Set<string>(),
  } = config;

  if (!doc) return null;

  return (
    <group name="schematic-scene" scale={[S, S, 1]}>
      {/* Wires */}
      <SchematicWires
        wires={doc.wires}
        selectedIds={selectedIds}
        session={session}
        colors={colors}
      />

      {/* Junction dots */}
      {connectivity?.junctions && (
        <JunctionDots
          junctions={connectivity.junctions.map((j) => ({
            x: j.position.x,
            y: j.position.y,
          }))}
          color={colors.junction}
        />
      )}

      {/* Net Labels */}
      <SchematicNetLabels
        labels={doc.labels}
        selectedIds={selectedIds}
        colors={colors}
      />

      {/* Symbols */}
      {doc.symbols.map((symbol) => (
        <SchematicSymbol
          key={symbol.id}
          symbol={symbol}
          selected={selectedIds.has(symbol.id)}
          connectedPinIds={connectedPinIds}
          colors={colors}
        />
      ))}

      {/* Selection overlay */}
      <SelectionOverlay
        selections={Array.from(selectedIds)
          .map((id) => {
            const bounds = symbolBounds[id];
            if (!bounds) return null;
            return { entityId: id, bounds };
          })
          .filter((s): s is NonNullable<typeof s> => s !== null)}
        strokeColor={colors.selectionStroke}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------
// SchematicSymbol — Single symbol with body + pins + labels
// ---------------------------------------------------------------------------

function SchematicSymbol({
  symbol,
  selected,
  connectedPinIds,
  colors,
}: {
  symbol: SymbolEntity;
  selected: boolean;
  connectedPinIds: ReadonlySet<string>;
  colors: CanvasColors;
}) {
  const rotationRad = degreesToRadians(symbol.rotation);

  const pinData = useMemo(
    () =>
      symbol.pins.map((pin) => ({
        id: pin.id,
        x: symbol.position.x + pin.position.x,
        y: symbol.position.y + pin.position.y,
        connected: connectedPinIds.has(pin.id),
      })),
    [symbol.pins, symbol.position, connectedPinIds],
  );

  return (
    <group
      name={`symbol-${symbol.id}`}
      position={[symbol.position.x, symbol.position.y, 0]}
      rotation={[0, 0, rotationRad]}
      scale={[symbol.mirrored ? -1 : 1, 1, 1]}
    >
      {/* Symbol body graphics */}
      {symbol.graphics && symbol.graphics.length > 0 && (
        <SymbolBody
          cacheKey={symbol.symbolKind}
          graphics={symbol.graphics}
          strokeColor={
            symbol.linkStatus === "missing" ? "#ef4444" : colors.bodyStroke
          }
          fillColor={colors.bodyFill}
          selected={selected}
          selectionColor={colors.selectionStroke}
        />
      )}

      {/* Reference label */}
      <EDAText
        position={[0, (symbol.bodyBounds?.maxY ?? 500_000) + 100_000, 0]}
        color={colors.refLabel}
        fontSize={Units.mmToNm(0.25)}
        anchorX="center"
        anchorY="bottom"
        renderOrder={RENDER_ORDER.LABELS}
      >
        {symbol.reference}
      </EDAText>

      {/* Value label */}
      {symbol.value && symbol.value !== symbol.reference && (
        <EDAText
          position={[0, (symbol.bodyBounds?.minY ?? -500_000) - 100_000, 0]}
          color={colors.valueLabel}
          fontSize={Units.mmToNm(0.2)}
          anchorX="center"
          anchorY="top"
          renderOrder={RENDER_ORDER.LABELS}
        >
          {symbol.value}
        </EDAText>
      )}

      {/* Pin dots (rendered in world space, outside symbol transform) */}
      <group
        position={[-symbol.position.x, -symbol.position.y, 0]}
        rotation={[0, 0, -rotationRad]}
        scale={[symbol.mirrored ? -1 : 1, 1, 1]}
      >
        <PinDots
          pins={pinData}
          defaultColor={colors.pinDot}
          connectedColor={colors.pinConnected}
        />
      </group>
    </group>
  );
}

// ---------------------------------------------------------------------------
// SchematicWires — wire collection + preview
// ---------------------------------------------------------------------------

function SchematicWires({
  wires,
  selectedIds,
  session,
  colors,
}: {
  wires: readonly WireEntity[];
  selectedIds: ReadonlySet<string>;
  session?: InteractionSession;
  colors: CanvasColors;
}) {
  const wireData = useMemo(
    () =>
      wires.map((w) => ({
        id: w.id,
        points: w.points,
        selected: selectedIds.has(w.id),
      })),
    [wires, selectedIds],
  );

  const previewPoints = session?.type === "wire" ? session.previewPoints : null;

  return (
    <WireLines
      wires={wireData}
      defaultColor={colors.wireDefault}
      selectedColor={colors.wireSelected}
      previewColor={colors.wirePreview}
      previewPoints={previewPoints}
    />
  );
}

// ---------------------------------------------------------------------------
// SchematicNetLabels
// ---------------------------------------------------------------------------

function SchematicNetLabels({
  labels,
  selectedIds,
  colors,
}: {
  labels: readonly NetLabelEntity[];
  selectedIds: ReadonlySet<string>;
  colors: CanvasColors;
}) {
  return (
    <group name="net-labels">
      {labels.map((label) => (
        <EDAText
          key={label.id}
          position={[label.position.x, label.position.y, 0]}
          color={
            selectedIds.has(label.id)
              ? colors.selectionStroke
              : colors.wireDefault
          }
          fontSize={Units.mmToNm(0.25)}
          anchorX="left"
          anchorY="bottom"
          rotation={[0, 0, degreesToRadians(label.rotation)]}
          renderOrder={RENDER_ORDER.LABELS}
        >
          {label.text}
        </EDAText>
      ))}
    </group>
  );
}
