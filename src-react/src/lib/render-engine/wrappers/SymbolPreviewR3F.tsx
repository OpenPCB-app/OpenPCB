/**
 * SymbolPreviewR3F — Read-only R3F symbol preview.
 *
 * Drop-in replacement for SymbolPreview. Accepts the same `symbolData` prop
 * and does async KiCad parsing internally, same as the original.
 */

import { useEffect, useMemo, useState } from "react";
import type { ComponentType } from "@shared/types/component-library-schema.types";
import { parseKicadSymbolImport } from "@/lib/api/component-api";
import { convertParsedKicadSymbolToDraft } from "@/components/symbol-editor/kicad-import";
import type { SymbolGraphic } from "@/lib/canvas-core/types";
import type { SymbolPin } from "@/components/symbol-editor/types";
import { useCanvasColors } from "@/lib/canvas-theme";
import { EdaCanvas } from "../interaction/EdaCanvas";
import { GridShader } from "../primitives/GridShader";
import { SymbolBody } from "../primitives/SymbolBody";
import { PinDots } from "../primitives/PinDots";
import { EDAText } from "../primitives/EDAText";
import { Units, GRID_PRESETS, nmToScene, NM_TO_SCENE } from "../coords";
import { RENDER_ORDER } from "../layers";

// ---------------------------------------------------------------------------
// Props (same as original SymbolPreview)
// ---------------------------------------------------------------------------

interface SymbolPreviewR3FProps {
  symbolData?: ComponentType["symbolData"];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SymbolPreviewR3F({ symbolData }: SymbolPreviewR3FProps) {
  const colors = useCanvasColors();
  const [draft, setDraft] = useState<{
    pins: SymbolPin[];
    graphics: SymbolGraphic[];
  } | null>(null);

  // Async parse rawKicadSource (same logic as original SymbolPreview)
  useEffect(() => {
    if (!symbolData?.rawKicadSource) {
      setDraft(null);
      return;
    }

    let cancelled = false;
    parseKicadSymbolImport(symbolData.rawKicadSource)
      .then((result) => {
        if (cancelled) return;
        const d = convertParsedKicadSymbolToDraft(result.symbol, "preview");
        setDraft({ pins: d.pins, graphics: d.graphics });
      })
      .catch(() => {
        if (!cancelled) setDraft(null);
      });

    return () => {
      cancelled = true;
    };
  }, [symbolData?.rawKicadSource]);

  // Resolve pins/graphics
  const resolvedData = useMemo(() => {
    if (!symbolData)
      return { pins: [] as SymbolPin[], graphics: [] as SymbolGraphic[] };
    if (draft) return { pins: draft.pins, graphics: draft.graphics };
    // Fallback: no graphics, just show pins from pinDefinitions
    return { pins: [] as SymbolPin[], graphics: [] as SymbolGraphic[] };
  }, [symbolData, draft]);

  const pinData = useMemo(
    () =>
      resolvedData.pins.map((pin) => ({
        id: pin.id,
        x: pin.position.x,
        y: pin.position.y,
        connected: false,
      })),
    [resolvedData.pins],
  );

  if (!symbolData) {
    return (
      <div
        className="flex h-[300px] items-center justify-center text-text-tertiary"
        data-testid="symbol-preview"
      >
        No symbol data
      </div>
    );
  }

  return (
    <EdaCanvas
      testId="symbol-preview"
      readOnly
      backgroundColor={colors.background}
      style={{ height: "300px" }}
    >
      <GridShader
        gridSize={nmToScene(GRID_PRESETS.STANDARD)}
        visible
        color={hexToRgb(colors.gridDot)}
        alpha={0.15}
      />

      <group scale={[1 / NM_TO_SCENE, 1 / NM_TO_SCENE, 1]}>
        {resolvedData.graphics.length > 0 && (
          <SymbolBody
            graphics={resolvedData.graphics}
            strokeColor={colors.bodyStroke}
            fillColor={colors.bodyFill}
          />
        )}

        <PinDots pins={pinData} defaultColor={colors.pinDot} />

        {resolvedData.pins.map((pin) => (
          <EDAText
            key={pin.id}
            position={[pin.position.x + 200_000, pin.position.y, 0]}
            color={colors.pinLabel}
            fontSize={Units.mmToNm(0.18)}
            anchorX="left"
            anchorY="middle"
            renderOrder={RENDER_ORDER.LABELS}
          >
            {pin.name}
          </EDAText>
        ))}
      </group>
    </EdaCanvas>
  );
}

function hexToRgb(color: string): [number, number, number] {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    return [
      parseInt(hex.slice(0, 2), 16) / 255,
      parseInt(hex.slice(2, 4), 16) / 255,
      parseInt(hex.slice(4, 6), 16) / 255,
    ];
  }
  return [0.58, 0.64, 0.72];
}
