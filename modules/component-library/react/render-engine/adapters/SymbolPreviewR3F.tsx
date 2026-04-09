import { useEffect, useMemo, useState } from "react";
import { useThree } from "@react-three/fiber";
import type { ComponentType } from "@shared/types/component-library-schema.types";
import type { SymbolGraphic as BackendSymbolGraphic } from "@shared/types/component-semantics.types";
import { parseKicadSymbolImport } from "@/lib/api/component-api";
import {
  convertParsedKicadSymbolToDraft,
  convertBodyGraphic,
} from "@/components/symbol-editor/kicad-import";
import type { SymbolPin } from "@/components/symbol-editor/types";
import {
  getSymbolPreviewLabel,
  isPowerSymbolData,
} from "@/components/library/symbolDataDisplay";
import { useCanvasColors } from "@/lib/canvas-theme";
import type { SymbolGraphic } from "@/editor-canvas/types/symbol-graphics";
import { EdaCanvas } from "@/editor-canvas/interaction";
import { EDAText, GridShader, PinDots, SymbolBody } from "@/editor-canvas/primitives";
import { parseShaderColor } from "@/editor-canvas/utils";
import { GRID_PRESETS, NM_TO_SCENE, Units, nmToSceneMm } from "@/editor-canvas/coords";
import { RENDER_ORDER } from "@/editor-canvas/layers";

interface SymbolPreviewR3FProps {
  symbolData?: ComponentType["symbolData"];
}

interface RawKicadBodyGraphic {
  unit: number;
  node: unknown[];
}

interface SymbolDraftData {
  pins: SymbolPin[];
  graphics: SymbolGraphic[];
}

interface SceneBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const PREVIEW_HEIGHT_PX = 250;
const PREVIEW_PADDING_PX = 30;
const MIN_CONTENT_SIZE_MM = 2.54;
const PIN_NAME_FONT_SIZE_NM = Units.mmToNm(0.18);
const PIN_NUMBER_FONT_SIZE_NM = Units.mmToNm(0.16);
const PIN_NAME_PADDING_NM = Units.mmToNm(0.4);
const PIN_NUMBER_PADDING_NM = Units.mmToNm(0.7);
const PREVIEW_LABEL_OFFSET_CLASS = "left-1/2 -translate-x-1/2";

function isRawKicadGraphic(value: unknown): value is RawKicadBodyGraphic {
  return (
    typeof value === "object" &&
    value !== null &&
    "node" in value &&
    Array.isArray((value as RawKicadBodyGraphic).node)
  );
}

function backendGraphicToEditor(
  graphic: BackendSymbolGraphic,
  index: number,
): SymbolGraphic {
  const base = { id: `preview-${index}`, zIndex: index };

  switch (graphic.type) {
    case "line":
      return {
        ...base,
        type: "line",
        x1: graphic.x1,
        y1: graphic.y1,
        x2: graphic.x2,
        y2: graphic.y2,
        strokeWidth: graphic.strokeWidth,
      };
    case "rect":
      return {
        ...base,
        type: "rect",
        x: graphic.x,
        y: graphic.y,
        width: graphic.width,
        height: graphic.height,
        filled: graphic.filled,
        strokeWidth: graphic.strokeWidth,
      };
    case "circle":
      return {
        ...base,
        type: "circle",
        cx: graphic.cx,
        cy: graphic.cy,
        radius: graphic.radius,
        filled: graphic.filled,
        strokeWidth: graphic.strokeWidth,
      };
    case "arc":
      return {
        ...base,
        type: "arc",
        cx: graphic.cx,
        cy: graphic.cy,
        radius: graphic.radius,
        startAngle: graphic.startAngle,
        endAngle: graphic.endAngle,
        strokeWidth: graphic.strokeWidth,
      };
    case "polygon":
      return {
        ...base,
        type: "polygon",
        points: graphic.points,
        filled: graphic.filled,
        closed: graphic.closed,
        strokeWidth: graphic.strokeWidth,
      };
    case "text":
      return {
        ...base,
        type: "text",
        x: graphic.x,
        y: graphic.y,
        content: graphic.content,
        fontSize: graphic.fontSize,
        rotation: graphic.rotation,
      };
  }
}

function convertBodyGraphics(bodyGraphics: unknown[]): SymbolGraphic[] {
  const graphics: SymbolGraphic[] = [];

  for (let index = 0; index < bodyGraphics.length; index += 1) {
    const graphic = bodyGraphics[index];
    if (!graphic) {
      continue;
    }

    if (isRawKicadGraphic(graphic)) {
      const converted = convertBodyGraphic(graphic.node, index);
      if (converted) {
        graphics.push(converted);
      }
      continue;
    }

    if (typeof graphic === "object" && graphic !== null && "type" in graphic) {
      graphics.push(
        backendGraphicToEditor(graphic as BackendSymbolGraphic, index),
      );
    }
  }

  return graphics;
}

function getPinBodyEnd(pin: SymbolPin) {
  switch (pin.side) {
    case "left":
      return { x: pin.position.x + pin.length, y: pin.position.y };
    case "right":
      return { x: pin.position.x - pin.length, y: pin.position.y };
    case "top":
      return { x: pin.position.x, y: pin.position.y - pin.length };
    case "bottom":
      return { x: pin.position.x, y: pin.position.y + pin.length };
  }
}

function computeBounds(
  pins: SymbolPin[],
  graphics: SymbolGraphic[],
): SceneBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const expand = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const pin of pins) {
    expand(pin.position.x, pin.position.y);
    const bodyEnd = getPinBodyEnd(pin);
    expand(bodyEnd.x, bodyEnd.y);
  }

  for (const graphic of graphics) {
    switch (graphic.type) {
      case "line":
        expand(graphic.x1, graphic.y1);
        expand(graphic.x2, graphic.y2);
        break;
      case "rect":
        expand(graphic.x, graphic.y);
        expand(graphic.x + graphic.width, graphic.y + graphic.height);
        break;
      case "circle":
        expand(graphic.cx - graphic.radius, graphic.cy - graphic.radius);
        expand(graphic.cx + graphic.radius, graphic.cy + graphic.radius);
        break;
      case "arc":
        expand(graphic.cx - graphic.radius, graphic.cy - graphic.radius);
        expand(graphic.cx + graphic.radius, graphic.cy + graphic.radius);
        break;
      case "polygon":
        for (const point of graphic.points) {
          expand(point.x, point.y);
        }
        break;
      case "text":
        expand(graphic.x, graphic.y);
        break;
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return null;
  }

  return {
    minX: nmToSceneMm(minX),
    minY: nmToSceneMm(minY),
    maxX: nmToSceneMm(maxX),
    maxY: nmToSceneMm(maxY),
  };
}

function createFallbackLayout(
  pinDefinitions: NonNullable<
    ComponentType["symbolData"]
  >["pinDefinitions"] = [],
  bodyGraphics: unknown[] = [],
): SymbolDraftData {
  const graphics = convertBodyGraphics(bodyGraphics);
  const bounds = computeBounds([], graphics);

  const bodyWidth = bounds
    ? Units.mmToNm(bounds.maxX - bounds.minX)
    : Units.mmToNm(10);
  const bodyHeight = bounds
    ? Units.mmToNm(bounds.maxY - bounds.minY)
    : Math.max(
        Units.mmToNm(5),
        (pinDefinitions.length * Units.mmToNm(1.27)) / 2,
      );
  const bodyMinX = bounds ? Units.mmToNm(bounds.minX) : -bodyWidth / 2;
  const bodyMinY = bounds ? Units.mmToNm(bounds.minY) : -bodyHeight / 2;

  if (graphics.length === 0) {
    const halfWidth = bodyWidth / 2;
    const pinsPerSide = Math.ceil(pinDefinitions.length / 2);
    const height = Math.max(Units.mmToNm(5), pinsPerSide * Units.mmToNm(2.54));
    graphics.push({
      id: "fallback-body",
      zIndex: 0,
      type: "rect",
      x: -halfWidth,
      y: -height / 2,
      width: bodyWidth,
      height,
      filled: false,
      strokeWidth: 0.254,
    });
  }

  const leftPins: Array<{
    name: string;
    electricalType: string;
    index: number;
  }> = [];
  const rightPins: Array<{
    name: string;
    electricalType: string;
    index: number;
  }> = [];

  pinDefinitions.forEach((pin, index) => {
    if (
      pin.electricalType === "output" ||
      pin.electricalType === "open_collector" ||
      pin.electricalType === "open_emitter"
    ) {
      rightPins.push({
        name: pin.name,
        electricalType: pin.electricalType,
        index,
      });
      return;
    }

    leftPins.push({
      name: pin.name,
      electricalType: pin.electricalType,
      index,
    });
  });

  while (
    leftPins.length >
    rightPins.length + Math.ceil(pinDefinitions.length * 0.3)
  ) {
    const moved = leftPins.pop();
    if (moved) {
      rightPins.push(moved);
    }
  }

  const pinLength = Units.mmToNm(2.54);
  const spacing = Units.mmToNm(2.54);
  const pins: SymbolPin[] = [];

  const layoutSide = (
    sidePins: Array<{ name: string; electricalType: string; index: number }>,
    side: SymbolPin["side"],
  ) => {
    const totalHeight = sidePins.length * spacing;
    const startY =
      (bounds ? bodyMinY + bodyHeight / 2 : 0) + totalHeight / 2 - spacing / 2;

    sidePins.forEach((pin, index) => {
      const y = startY - index * spacing;
      const x =
        side === "left"
          ? (bounds ? bodyMinX : -bodyWidth / 2) - pinLength
          : (bounds ? bodyMinX + bodyWidth : bodyWidth / 2) + pinLength;

      pins.push({
        id: `fallback-pin-${pin.index}`,
        name: pin.name,
        number: String(pin.index + 1),
        electricalType: pin.electricalType as SymbolPin["electricalType"],
        side,
        position: { x, y },
        length: pinLength,
      });
    });
  };

  layoutSide(leftPins, "left");
  layoutSide(rightPins, "right");

  return { pins, graphics };
}

function clampZoom(value: number) {
  return Math.min(180, Math.max(12, value));
}

function PreviewCameraFit({ bounds }: { bounds: SceneBounds | null }) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const orthographicCamera = camera;
    if (!("zoom" in orthographicCamera)) {
      return;
    }

    if (!bounds) {
      orthographicCamera.position.x = 0;
      orthographicCamera.position.y = 0;
      orthographicCamera.zoom = 50;
      orthographicCamera.updateProjectionMatrix();
      invalidate();
      return;
    }

    const contentWidth = Math.max(
      bounds.maxX - bounds.minX,
      MIN_CONTENT_SIZE_MM,
    );
    const contentHeight = Math.max(
      bounds.maxY - bounds.minY,
      MIN_CONTENT_SIZE_MM,
    );
    const usableWidth = Math.max(size.width - PREVIEW_PADDING_PX * 2, 1);
    const usableHeight = Math.max(size.height - PREVIEW_PADDING_PX * 2, 1);

    orthographicCamera.position.x = (bounds.minX + bounds.maxX) / 2;
    orthographicCamera.position.y = (bounds.minY + bounds.maxY) / 2;
    orthographicCamera.zoom = clampZoom(
      Math.min(usableWidth / contentWidth, usableHeight / contentHeight),
    );
    orthographicCamera.updateProjectionMatrix();
    invalidate();
  }, [bounds, camera, invalidate, size.height, size.width]);

  return null;
}

function PreviewEmptyState({
  testId,
  message,
}: {
  testId: string;
  message: string;
}) {
  return (
    <div
      className="flex h-[250px] items-center justify-center rounded border border-border-default bg-bg-input text-sm text-text-tertiary"
      data-testid={testId}
    >
      {message}
    </div>
  );
}

function PinLineSegments({
  pins,
  color,
}: {
  pins: SymbolPin[];
  color: string;
}) {
  const positions = useMemo(() => {
    const values: number[] = [];

    for (const pin of pins) {
      const bodyEnd = getPinBodyEnd(pin);
      values.push(pin.position.x, pin.position.y, 0, bodyEnd.x, bodyEnd.y, 0);
    }

    return new Float32Array(values);
  }, [pins]);

  if (positions.length === 0) {
    return null;
  }

  return (
    <lineSegments renderOrder={RENDER_ORDER.PINS} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={color} depthTest={false} depthWrite={false} />
    </lineSegments>
  );
}

function getPinNamePosition(pin: SymbolPin) {
  const bodyEnd = getPinBodyEnd(pin);

  switch (pin.side) {
    case "left":
      return {
        x: bodyEnd.x + PIN_NAME_PADDING_NM,
        y: bodyEnd.y,
        anchorX: "left" as const,
      };
    case "right":
      return {
        x: bodyEnd.x - PIN_NAME_PADDING_NM,
        y: bodyEnd.y,
        anchorX: "right" as const,
      };
    case "top":
      return {
        x: bodyEnd.x,
        y: bodyEnd.y + PIN_NAME_PADDING_NM,
        anchorX: "center" as const,
      };
    case "bottom":
      return {
        x: bodyEnd.x,
        y: bodyEnd.y - PIN_NAME_PADDING_NM,
        anchorX: "center" as const,
      };
  }
}

function getPinNumberPosition(pin: SymbolPin) {
  switch (pin.side) {
    case "left":
      return {
        x: pin.position.x - PIN_NUMBER_PADDING_NM,
        y: pin.position.y,
        anchorX: "right" as const,
      };
    case "right":
      return {
        x: pin.position.x + PIN_NUMBER_PADDING_NM,
        y: pin.position.y,
        anchorX: "left" as const,
      };
    case "top":
      return {
        x: pin.position.x,
        y: pin.position.y + PIN_NUMBER_PADDING_NM,
        anchorX: "center" as const,
      };
    case "bottom":
      return {
        x: pin.position.x,
        y: pin.position.y - PIN_NUMBER_PADDING_NM,
        anchorX: "center" as const,
      };
  }
}

export function SymbolPreviewR3F({ symbolData }: SymbolPreviewR3FProps) {
  const colors = useCanvasColors();
  const [draft, setDraft] = useState<SymbolDraftData | null>(null);

  useEffect(() => {
    if (!symbolData?.rawKicadSource) {
      setDraft(null);
      return;
    }

    let cancelled = false;
    parseKicadSymbolImport(symbolData.rawKicadSource)
      .then((result) => {
        if (cancelled) {
          return;
        }

        const converted = convertParsedKicadSymbolToDraft(
          result.symbol,
          "preview",
        );
        setDraft({ pins: converted.pins, graphics: converted.graphics });
      })
      .catch(() => {
        if (!cancelled) {
          setDraft(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [symbolData?.rawKicadSource]);

  const resolvedData = useMemo<SymbolDraftData>(() => {
    if (!symbolData) {
      return { pins: [], graphics: [] };
    }

    if (draft) {
      return draft;
    }

    return createFallbackLayout(
      symbolData.pinDefinitions ?? [],
      (symbolData.bodyGraphics ?? []) as unknown[],
    );
  }, [draft, symbolData]);

  const pinDots = useMemo(
    () =>
      resolvedData.pins.map((pin) => ({
        id: pin.id,
        x: pin.position.x,
        y: pin.position.y,
        connected: false,
      })),
    [resolvedData.pins],
  );
  const bounds = useMemo(
    () => computeBounds(resolvedData.pins, resolvedData.graphics),
    [resolvedData.graphics, resolvedData.pins],
  );

  if (!symbolData) {
    return (
      <PreviewEmptyState
        testId="symbol-preview"
        message="No symbol data available"
      />
    );
  }

  const isPowerSymbol = isPowerSymbolData(symbolData);
  const previewLabel = getSymbolPreviewLabel(symbolData);

  return (
    <div className="relative">
      <EdaCanvas
        testId="symbol-preview"
        readOnly
        backgroundColor={colors.background}
        className="rounded border border-border-default bg-bg-input"
        style={{ height: `${PREVIEW_HEIGHT_PX}px` }}
      >
        <PreviewCameraFit bounds={bounds} />
        <GridShader
          gridSize={nmToSceneMm(GRID_PRESETS.STANDARD)}
          visible
          color={parseShaderColor(colors.gridDot)}
          alpha={0.15}
        />

        <group scale={[1 / NM_TO_SCENE, 1 / NM_TO_SCENE, 1]}>
          <PinLineSegments pins={resolvedData.pins} color={colors.pinLine} />

          {resolvedData.graphics.length > 0 && (
            <SymbolBody
              graphics={resolvedData.graphics}
              strokeColor={colors.bodyStroke}
              fillColor={colors.bodyFill}
            />
          )}

          <PinDots pins={pinDots} defaultColor={colors.pinDot} />

          {!isPowerSymbol &&
            resolvedData.pins.map((pin) => {
              const namePosition = getPinNamePosition(pin);
              const numberPosition = getPinNumberPosition(pin);

              return (
                <group key={pin.id}>
                  {pin.name && (
                    <EDAText
                      position={[namePosition.x, namePosition.y, 0]}
                      color={colors.pinLabel}
                      fontSize={PIN_NAME_FONT_SIZE_NM}
                      anchorX={namePosition.anchorX}
                      anchorY="middle"
                      renderOrder={RENDER_ORDER.LABELS}
                    >
                      {pin.name}
                    </EDAText>
                  )}

                  {pin.number && (
                    <EDAText
                      position={[numberPosition.x, numberPosition.y, 0]}
                      color={colors.pinNumber}
                      fontSize={PIN_NUMBER_FONT_SIZE_NM}
                      anchorX={numberPosition.anchorX}
                      anchorY="middle"
                      renderOrder={RENDER_ORDER.LABELS}
                    >
                      {pin.number}
                    </EDAText>
                  )}
                </group>
              );
            })}
        </group>
      </EdaCanvas>

      <div
        className={`pointer-events-none absolute ${PREVIEW_LABEL_OFFSET_CLASS} ${
          isPowerSymbol ? "bottom-3" : "top-3"
        } text-xs font-semibold`}
        style={{ color: colors.refLabel }}
      >
        {previewLabel}
      </div>
    </div>
  );
}
