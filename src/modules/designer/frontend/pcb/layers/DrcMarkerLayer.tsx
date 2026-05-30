import { useFrame, useThree } from "@react-three/fiber";
import { type ReactElement, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { RENDER_ORDER } from "../../../../../shared/frontend/canvas/layers";
import { DRC_RING, DRC_SEVERITY, DRC_STROKE } from "../drc/drc-colors";
import { buildDrcMarkers } from "../drc/drc-labels";
import { useDrcStore } from "../drc/drc-store";
import { usePcbViewStore } from "../pcb-view-store";

// Above EVERYTHING (copper, pads, vias, drill rings, labels, selection,
// preview) so a violation is never hidden under the geometry it flags. We use a
// deliberately huge constant so no board element can out-sort it.
//
// TWO things are required for that to actually hold:
//  1. Every mesh is `transparent` — copper is rendered in the transparent pass
//     (for the per-layer opacity sliders), and Three.js draws the whole
//     transparent pass after the opaque pass; an *opaque* marker would be
//     painted over by transparent copper.
//  2. `MARKER_ORDER` is set on the wrapping <group>, not just the meshes.
//     Three.js sorts the transparent pass by GROUP order FIRST, then mesh
//     renderOrder. The plated-hole cutout draws its discs inside a
//     `<group renderOrder={SELECTION+0.25}>` (groupOrder ≈ 19.25); a marker
//     whose meshes carry renderOrder 1000 but whose group has the default
//     groupOrder 0 still sorts BELOW that cutout and gets punched at the hole.
//     Wrapping the markers in `<group renderOrder={MARKER_ORDER}>` gives every
//     marker mesh groupOrder 1000, which beats the cutout. (Per-mesh
//     renderOrder still orders the glow/stroke/ring/core within the marker.)
const MARKER_ORDER = 1000;
// Target on-screen marker (core) size (px); kept constant across zoom.
const MARKER_PX = 15;
const SELECTED_MULT = 1.7;
const HOVER_MULT = 1.45;

// Per-layer scale relative to the core (=1), back to front. A thick white ring
// is the key contrast band — it must stay clearly visible even when an error
// (red) core sits on red copper, so the ring is generous relative to the core.
const GLOW_SCALE = 3.6;
const STROKE_SCALE = 1.78;
const RING_SCALE = 1.45;
// Soft beacon opacity (additive) — brighter when hovered.
const GLOW_OPACITY = 0.26;
const GLOW_OPACITY_HOVER = 0.4;

/**
 * DRC violation markers — a layered diamond "badge" at each violation's
 * locationMm: a soft severity-colored glow beacon (so violations are spottable
 * at whole-board zoom), a dark outer stroke, a bright white ring (the contrast
 * key that separates the marker from BOTH red/blue copper and the near-black
 * background), and a severity-colored core. Constant ~14px on screen
 * (zoom-independent); enlarges on hover/selection. Reads the report + selection
 * + hover from `useDrcStore` and waivers from `usePcbViewStore`. Lives inside
 * the board mirror group; R3F demand-rendered.
 */
export function DrcMarkerLayer(): ReactElement | null {
  const report = useDrcStore((s) => s.report);
  const selectedId = useDrcStore((s) => s.selectedId);
  const hoveredId = useDrcStore((s) => s.hoveredId);
  const markersVisible = useDrcStore((s) => s.markersVisible);
  const waivedIds = usePcbViewStore((s) => s.viewState.drcWaivedViolationIds);
  const invalidate = useThree((s) => s.invalidate);

  // Unit diamond (half-extent 1) reused by every marker + layer.
  const diamond = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 1);
    shape.lineTo(1, 0);
    shape.lineTo(0, -1);
    shape.lineTo(-1, 0);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, []);
  useEffect(() => () => diamond.dispose(), [diamond]);

  const markers = useMemo(
    () =>
      markersVisible
        ? buildDrcMarkers(report, selectedId, hoveredId, waivedIds)
        : [],
    [markersVisible, report, selectedId, hoveredId, waivedIds],
  );

  const groupRefs = useRef<Array<THREE.Group | null>>([]);

  // Keep markers a constant screen size: ortho `camera.zoom` ≈ px-per-mm, so a
  // marker of world half-extent `(MARKER_PX/2)/zoom` renders at MARKER_PX px.
  useFrame(({ camera }) => {
    const zoom = (camera as THREE.OrthographicCamera).zoom || 1;
    const base = MARKER_PX / 2 / zoom;
    for (let i = 0; i < groupRefs.current.length; i += 1) {
      const g = groupRefs.current[i];
      if (!g) continue;
      const m = markers[i];
      const mult = m?.selected ? SELECTED_MULT : m?.hovered ? HOVER_MULT : 1;
      g.scale.setScalar(base * mult);
    }
  });

  // useFrame does not auto-render under frameloop="demand" — schedule a frame
  // whenever the marker set or hover changes so the scale/opacity re-applies.
  useEffect(() => {
    invalidate();
  }, [markers, invalidate]);

  if (markers.length === 0) return null;

  return (
    // renderOrder on THIS group sets the groupOrder (primary transparent-sort
    // key) for every marker mesh below — see the MARKER_ORDER note above.
    <group renderOrder={MARKER_ORDER}>
      {markers.map((m, i) => {
        const sev = DRC_SEVERITY[m.severity];
        return (
          <group
            key={m.id}
            position={[m.x, m.y, 0]}
            ref={(el) => {
              groupRefs.current[i] = el;
            }}
          >
            {/* Beacon glow (additive) — large + soft so it telegraphs the
                violation even when the badge shrinks at whole-board zoom. */}
            <mesh
              geometry={diamond}
              renderOrder={MARKER_ORDER - 0.03}
              scale={GLOW_SCALE}
            >
              <meshBasicMaterial
                color={sev.glow}
                toneMapped={false}
                depthTest={false}
                depthWrite={false}
                transparent
                opacity={m.hovered ? GLOW_OPACITY_HOVER : GLOW_OPACITY}
                blending={THREE.AdditiveBlending}
              />
            </mesh>
            {/* Dark outer stroke — separation from light areas (silkscreen). */}
            <mesh
              geometry={diamond}
              renderOrder={MARKER_ORDER - 0.02}
              scale={STROKE_SCALE}
            >
              <meshBasicMaterial
                color={DRC_STROKE}
                toneMapped={false}
                depthTest={false}
                depthWrite={false}
                transparent
              />
            </mesh>
            {/* Bright white ring — the contrast key (pops on red/blue copper). */}
            <mesh
              geometry={diamond}
              renderOrder={MARKER_ORDER - 0.01}
              scale={RING_SCALE}
            >
              <meshBasicMaterial
                color={DRC_RING}
                toneMapped={false}
                depthTest={false}
                depthWrite={false}
                transparent
              />
            </mesh>
            {/* Severity-colored core. */}
            <mesh geometry={diamond} renderOrder={MARKER_ORDER}>
              <meshBasicMaterial
                color={sev.core}
                toneMapped={false}
                depthTest={false}
                depthWrite={false}
                transparent
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
