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
  /**
   * Layers to skip entirely (graphics + labels not rendered). Use for PCB canvas
   * default-hide of F.Fab / F.Fabrication so KiCad's user-text `${REFERENCE}`
   * placeholders don't overlay pads at the footprint origin.
   */
  hiddenLayers?: ReadonlySet<string>;
  /** When true, color pads + graphics by their layer using PCB_LAYER_COLORS. */
  useLayerColors?: boolean;
  /** Rendering surface — "preview" (default, library tile colors) or "pcb" (PCB canvas tokens). */
  surface?: "preview" | "pcb";
  /**
   * Substitute KiCad placeholder tokens in label.text. When a placement has an
   * assigned reference (e.g. "R1") and value (e.g. "10k"), pass them here so
   * labels render the real designator instead of the literal "REF**" / "VALUE".
   */
  placeholderSubstitutions?: {
    reference?: string;
    value?: string;
  };
  /**
   * When true, pads/lines/drills participate in depth testing/writing so 3D
   * geometry above them (component bodies) correctly occludes them. Default
   * false preserves the 2D canvas overlay convention (always-on-top).
   */
  enableDepthTest?: boolean;
  /**
   * When true, per-pad number labels (e.g. "1", "2", "65") are not rendered.
   * Used by the 3D PCB board view where pad numbers are clutter on top of
   * component bodies. Default false keeps existing 2D canvas behavior.
   */
  hidePadNumbers?: boolean;
  /**
   * Optional remap applied to every layer string the renderer consumes
   * (graphics / pads / labels) before color / hidden / dimmed lookup. Used
   * by the 2D PCB canvas to remap F.* ↔ B.* atomically when a placement is
   * on the bottom side, mirroring the KiCad flip semantics. Through-hole
   * (`*.Cu`) and `Edge.Cuts` should pass through unchanged.
  */
  layerRemap?: (layer: string | undefined) => string | undefined;
  /** Pad numbers to visually dim while keeping them rendered for context. */
  dimmedPadNumbers?: ReadonlySet<string>;
  /** Strength for pad dimming; color is multiplied instead of per-instance alpha. */
  padDimFactor?: number;
  /** Opacity for dimmed footprint graphics/labels. */
  dimmedOpacity?: number;
}

const REFERENCE_TOKEN_RE = /\$\{REFERENCE\}|REF\*\*/g;
const VALUE_TOKEN_RE = /\$\{VALUE\}|(?<![A-Za-z])VALUE(?![A-Za-z])/g;

function applyPlaceholderSubstitutions(
  text: string,
  subs: { reference?: string; value?: string } | undefined,
): string {
  if (!subs) return text;
  let out = text;
  if (subs.reference) {
    out = out.replace(REFERENCE_TOKEN_RE, subs.reference);
  }
  if (subs.value) {
    out = out.replace(VALUE_TOKEN_RE, subs.value);
  }
  return out;
}

function layerColor(
  layer: string | undefined,
  pt: { footprintSilk: string; footprintPad: string },
): string {
  if (!layer) return pt.footprintSilk;
  return (
    PCB_LAYER_COLORS[layer as keyof typeof PCB_LAYER_COLORS] ?? pt.footprintSilk
  );
}

/** Color for *.Cu (all-copper) pads — copper/gold for plated through-hole. */
const ALL_CU_COLOR = "#d4925b";
const DIM_FACTOR = 0.32;

/**
 * Pick the canvas render order for a silkscreen / courtyard / fab stroke
 * group. Back-side layers must draw at `BACK_SILKSCREEN` (lower) so they
 * sit beneath bottom copper finish; front-side layers draw at
 * `FRONT_SILKSCREEN` (above bottom + mid stack).
 */
function silkscreenRenderOrder(layer: string | undefined): number {
  if (layer && layer.startsWith("B.")) return RENDER_ORDER.BACK_SILKSCREEN;
  return RENDER_ORDER.FRONT_SILKSCREEN;
}

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

function padLayerColor(
  layer: string | undefined,
  pt: { footprintPad: string },
): string {
  if (!layer) return pt.footprintPad;
  if (layer === "*.Cu") return ALL_CU_COLOR;
  return (
    PCB_LAYER_COLORS[layer as keyof typeof PCB_LAYER_COLORS] ?? pt.footprintPad
  );
}

interface LayerGraphicGroup {
  layer: string;
  positions: Float32Array;
}

export function FootprintRenderLayer({
  model,
  dimmedLayers,
  hiddenLayers,
  useLayerColors = false,
  surface = "preview",
  placeholderSubstitutions,
  enableDepthTest = false,
  hidePadNumbers = false,
  layerRemap,
  dimmedPadNumbers,
  padDimFactor = DIM_FACTOR,
  dimmedOpacity = 0.3,
}: FootprintRenderLayerProps) {
  const remap = (layer: string | undefined): string | undefined =>
    layerRemap ? layerRemap(layer) : layer;
  const isHidden = (layer: string | undefined): boolean => {
    const effective = remap(layer);
    return effective !== undefined && hiddenLayers?.has(effective) === true;
  };
  const isDimmedLayer = (layer: string | undefined): boolean => {
    if (!dimmedLayers) return false;
    const effective = remap(layer);
    return effective !== undefined && dimmedLayers.has(effective);
  };
  const { theme } = useCanvasTheme();
  const basePreview = theme.preview;
  // For PCB surface, override the few preview tokens that are unreadable on dark
  // board fill (golden pad number text) with PCB canvas tokens. Pad fill colors
  // are routed through PCB_LAYER_COLORS via useLayerColors, not these tokens.
  const pt =
    surface === "pcb"
      ? {
          ...basePreview,
          footprintPadNumber: theme.pcbCanvas.padNumberText,
          footprintSilk: theme.pcbCanvas.silkscreen,
          footprintFab: theme.pcbCanvas.fab,
          footprintDrill: theme.pcbCanvas.drill,
        }
      : basePreview;

  // ── Graphics grouped by layer ──────────────────────────────────────
  const graphicGroups = useMemo(() => {
    if (!useLayerColors) {
      // Legacy path: single group, single color
      const values: number[] = [];
      for (const graphic of model.graphics) {
        if (isHidden(graphic.layer)) continue;
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
      if (isHidden(graphic.layer)) continue;
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
    // hiddenLayers participates by reference identity — callers should keep it
    // stable (or memoized) to avoid spurious recomputes.
  }, [model.graphics, useLayerColors, hiddenLayers, layerRemap]);

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

        const effectiveLayer = remap(pad.layer ?? "F.Cu");
        const isDimmedLayer =
          (effectiveLayer !== undefined && dimmedLayers?.has(effectiveLayer)) ??
          false;
        const isDimmedPad = dimmedPadNumbers?.has(pad.number) ?? false;
        const isDimmed = isDimmedLayer || isDimmedPad;
        let color = useLayerColors
          ? padLayerColor(effectiveLayer, pt)
          : undefined;
        if (isDimmed && color) color = dimHex(color, padDimFactor);

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
    [model.pads, dimmedLayers, dimmedPadNumbers, padDimFactor, useLayerColors, layerRemap],
  );

  return (
    <>
      {/* Stroke graphics — per-layer colored when useLayerColors is true */}
      {graphicGroups.map((group) => {
        const effectiveLayer =
          group.layer === "__all__" || group.layer === "__none__"
            ? undefined
            : remap(group.layer);
        const color = useLayerColors
          ? layerColor(effectiveLayer, pt)
          : pt.footprintSilk;
        const isDimmed =
          dimmedLayers !== undefined &&
          effectiveLayer !== undefined &&
          dimmedLayers.has(effectiveLayer);
        return (
          <lineSegments
            key={group.layer}
            renderOrder={silkscreenRenderOrder(effectiveLayer)}
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
              depthTest={enableDepthTest}
              depthWrite={enableDepthTest}
              transparent={!enableDepthTest || isDimmed}
              opacity={isDimmed ? dimmedOpacity : 1}
            />
          </lineSegments>
        );
      })}

      {/* Pads */}
      <PadInstances
        pads={padData}
        defaultColor={pt.footprintPad}
        enableDepthTest={enableDepthTest}
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
              depthTest={enableDepthTest}
              depthWrite={enableDepthTest}
              transparent={!enableDepthTest}
            />
          </mesh>
        ) : null,
      )}

      {/* Pad numbers — hidden in 3D PCB board view (clutter on top of bodies) */}
      {!hidePadNumbers &&
        model.pads.map((pad) => {
          const isDimmedPad = dimmedPadNumbers?.has(pad.number) ?? false;
          return (
            <EDAText
              key={`${pad.id}:number`}
              position={[pad.centerMm.x, pad.centerMm.y, 0]}
              color={pt.footprintPadNumber}
              fontSize={0.28}
              anchorX="center"
              anchorY="middle"
              opacity={isDimmedPad ? Math.max(dimmedOpacity, 0.18) : undefined}
            >
              {pad.number}
            </EDAText>
          );
        })}

      {/* Labels — per-layer color, with PCB-surface override for Fab text */}
      {model.labels.map((label) => {
        if (isHidden(label.layer)) return null;
        const effectiveLayer = remap(label.layer);
        const isFab = effectiveLayer?.includes("Fab") ?? false;
        const color =
          surface === "pcb" && isFab
            ? theme.pcbCanvas.refdesLabel
            : useLayerColors
              ? layerColor(effectiveLayer, pt)
              : isFab
                ? pt.footprintFab
                : pt.footprintSilk;
        const isDimmed = isDimmedLayer(label.layer);
        const text = applyPlaceholderSubstitutions(
          label.text,
          placeholderSubstitutions,
        );
        return (
          <EDAText
            key={label.id}
            position={[label.at.x, label.at.y, 0]}
            color={color}
            fontSize={label.fontSizeMm}
            anchorX={label.anchorX}
            anchorY={label.anchorY}
            opacity={isDimmed ? dimmedOpacity : undefined}
            rotation={
              label.rotationDeg === 0
                ? undefined
                : [0, 0, (label.rotationDeg * Math.PI) / 180]
            }
          >
            {text}
          </EDAText>
        );
      })}
    </>
  );
}
