import { useMemo } from "react";
import { EDAText, PadInstances } from "../primitives";
import type { FootprintRenderModel, PreviewGraphic } from "../../../rendering";
import { RENDER_ORDER, PCB_LAYER_COLORS } from "../layers";
import { useCanvasTheme } from "../theme";
import { graphicStrokeSegments } from "../preview/geometry";

export interface FootprintRenderLayerProps {
  model: FootprintRenderModel;
  /** Layers to render at reduced opacity (~30%). Used by footprint editor for inactive-layer dimming. */
  dimmedLayers?: ReadonlySet<string>;
  /** When true, color pads + graphics by their layer using PCB_LAYER_COLORS. */
  useLayerColors?: boolean;
}

function layerColor(layer: string | undefined, pt: { footprintSilk: string; footprintPad: string }): string {
  if (!layer) return pt.footprintSilk;
  return (
    PCB_LAYER_COLORS[layer as keyof typeof PCB_LAYER_COLORS] ??
    pt.footprintSilk
  );
}

/** Color for *.Cu (all-copper) pads — blend of F.Cu and B.Cu. */
const ALL_CU_COLOR = "#9a6a30";
const DIM_FACTOR = 0.3;

/** Darken a hex color to simulate dimming (multiply RGB by factor). */
function dimHex(hex: string, factor: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const dr = Math.round(r * factor);
  const dg = Math.round(g * factor);
  const db = Math.round(b * factor);
  return `#${dr.toString(16).padStart(2, "0")}${dg.toString(16).padStart(2, "0")}${db.toString(16).padStart(2, "0")}`;
}

function padLayerColor(layer: string | undefined, pt: { footprintPad: string }): string {
  if (!layer) return pt.footprintPad;
  if (layer === "*.Cu") return ALL_CU_COLOR;
  return (
    PCB_LAYER_COLORS[layer as keyof typeof PCB_LAYER_COLORS] ??
    pt.footprintPad
  );
}

interface LayerGraphicGroup {
  layer: string;
  positions: Float32Array;
}

export function FootprintRenderLayer({
  model,
  dimmedLayers,
  useLayerColors = false,
}: FootprintRenderLayerProps) {
  const { theme } = useCanvasTheme();
  const pt = theme.preview;

  // ── Graphics grouped by layer ──────────────────────────────────────
  const graphicGroups = useMemo(() => {
    if (!useLayerColors) {
      // Legacy path: single group, single color
      const values: number[] = [];
      for (const graphic of model.graphics) {
        for (const seg of graphicStrokeSegments(graphic)) {
          values.push(seg[0], seg[1], 0, seg[2], seg[3], 0);
        }
      }
      if (values.length === 0) return [];
      return [
        { layer: "__all__", positions: new Float32Array(values) },
      ] as LayerGraphicGroup[];
    }

    const byLayer = new Map<string, number[]>();
    for (const graphic of model.graphics) {
      const key = graphic.layer ?? "__none__";
      let arr = byLayer.get(key);
      if (!arr) {
        arr = [];
        byLayer.set(key, arr);
      }
      for (const seg of graphicStrokeSegments(graphic)) {
        arr.push(seg[0], seg[1], 0, seg[2], seg[3], 0);
      }
    }

    const groups: LayerGraphicGroup[] = [];
    for (const [layer, values] of byLayer) {
      if (values.length > 0) {
        groups.push({ layer, positions: new Float32Array(values) });
      }
    }
    return groups;
  }, [model.graphics, useLayerColors]);

  // ── Pads ───────────────────────────────────────────────────────────
  const padData = useMemo(
    () =>
      model.pads.map((pad) => {
        const shape: "circle" | "rect" | "oval" | "roundrect" =
          pad.shape === "circle" ||
          pad.shape === "oval" ||
          pad.shape === "roundrect"
            ? pad.shape
            : "rect";

        const padLayer = pad.layer ?? "F.Cu";
        const isDimmed = dimmedLayers?.has(padLayer) ?? false;
        let color = useLayerColors ? padLayerColor(pad.layer, pt) : undefined;
        if (isDimmed && color) color = dimHex(color, DIM_FACTOR);

        return {
          id: pad.id,
          x: pad.centerMm.x,
          y: pad.centerMm.y,
          width: pad.widthMm,
          height: pad.heightMm,
          rotation: pad.rotationDeg,
          shape,
          roundrectRatio: pad.roundrectRatio,
          color,
          selected: false,
        };
      }),
    [model.pads, dimmedLayers, useLayerColors],
  );

  return (
    <>
      {/* Stroke graphics — per-layer colored when useLayerColors is true */}
      {graphicGroups.map((group) => {
        const color = useLayerColors
          ? layerColor(
              group.layer === "__all__" || group.layer === "__none__"
                ? undefined
                : group.layer,
              pt,
            )
          : pt.footprintSilk;
        const isDimmed =
          dimmedLayers !== undefined &&
          group.layer !== "__all__" &&
          group.layer !== "__none__" &&
          dimmedLayers.has(group.layer);
        return (
          <lineSegments
            key={group.layer}
            renderOrder={RENDER_ORDER.FRONT_SILKSCREEN}
            frustumCulled={false}
          >
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                args={[group.positions, 3]}
              />
            </bufferGeometry>
            <lineBasicMaterial
              color={color}
              depthTest={false}
              depthWrite={false}
              transparent={isDimmed}
              opacity={isDimmed ? 0.3 : 1}
            />
          </lineSegments>
        );
      })}

      {/* Pads */}
      <PadInstances
        pads={padData}
        defaultColor={pt.footprintPad}
      />

      {/* Drill holes */}
      {model.pads.map((pad) =>
        pad.drillDiameterMm && pad.drillDiameterMm > 0 ? (
          <mesh
            key={`${pad.id}:drill`}
            position={[pad.centerMm.x, pad.centerMm.y, 0]}
            renderOrder={RENDER_ORDER.PINS + 0.2}
          >
            <circleGeometry args={[pad.drillDiameterMm / 2, 20]} />
            <meshBasicMaterial
              color={pt.footprintDrill}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        ) : null,
      )}

      {/* Pad numbers */}
      {model.pads.map((pad) => (
        <EDAText
          key={`${pad.id}:number`}
          position={[pad.centerMm.x, pad.centerMm.y, 0]}
          color={pt.footprintPadNumber}
          fontSize={0.28}
          anchorX="center"
          anchorY="middle"
        >
          {pad.number}
        </EDAText>
      ))}

      {/* Labels — use per-layer color when enabled */}
      {model.labels.map((label) => {
        const color = useLayerColors
          ? layerColor(label.layer, pt)
          : label.layer?.includes("Fab")
            ? pt.footprintFab
            : pt.footprintSilk;
        const isDimmed =
          dimmedLayers !== undefined &&
          label.layer !== undefined &&
          dimmedLayers.has(label.layer);
        return (
          <EDAText
            key={label.id}
            position={[label.at.x, label.at.y, 0]}
            color={color}
            fontSize={label.fontSizeMm}
            anchorX={label.anchorX}
            anchorY={label.anchorY}
            opacity={isDimmed ? 0.3 : undefined}
            rotation={
              label.rotationDeg === 0
                ? undefined
                : [0, 0, (label.rotationDeg * Math.PI) / 180]
            }
          >
            {label.text}
          </EDAText>
        );
      })}
    </>
  );
}
